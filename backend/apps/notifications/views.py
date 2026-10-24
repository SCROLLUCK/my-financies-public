import logging

import requests
from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.chat import service as chat_service
from apps.chat import write_tools
from apps.chat.models import ChatMessage, Conversation, LastCaptureAction
from apps.expenses.models import Category, Expense, Merchant
from apps.receipts import services as receipt_services
from apps.receipts.models import Receipt

from . import gateway
from .models import NotificationSetting, ProcessedWaMessage
from .permissions import HasGatewaySecret
from .serializers import NotificationSettingSerializer

logger = logging.getLogger(__name__)

CONFIRM_WORDS = {"✅", "confirmar", "confirma", "sim"}
CANCEL_WORDS = {"cancelar", "não", "nao"}
UNDO_WORDS = {"desfazer", "desfaz"}
MAX_HISTORY_MESSAGES = 40

UNDO_REPLY = {
    "register_expense": "Desfeito! A despesa foi removida.",
    "mark_bill_paid": "Desfeito! A conta voltou a ficar pendente.",
    "add_shopping_item": "Desfeito! O item foi removido da lista.",
}


class NotificationSettingView(APIView):
    """Read/update the singleton notification settings row."""

    def get(self, request):
        return Response(NotificationSettingSerializer(NotificationSetting.load()).data)

    def patch(self, request):
        setting = NotificationSetting.load()
        serializer = NotificationSettingSerializer(setting, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class GatewayStatusView(APIView):
    def get(self, request):
        try:
            return Response(gateway.get_status())
        except gateway.GatewayError:
            return Response({"state": "unreachable", "connected": False})


class GatewayChatsView(APIView):
    def get(self, request):
        try:
            return Response(gateway.list_chats())
        except gateway.GatewayError:
            return Response([])


class GatewayQRView(APIView):
    """Streams the gateway's QR PNG straight through, so the browser never
    needs to reach the (internal-only) gateway directly."""

    def get(self, request):
        try:
            resp = requests.get(f"{settings.WHATSAPP_GATEWAY_URL.rstrip('/')}/qr", timeout=5)
        except requests.RequestException:
            return HttpResponse(status=503)
        if resp.status_code != 200:
            return HttpResponse(status=404)
        return HttpResponse(resp.content, content_type="image/png")


class TestSendView(APIView):
    def post(self, request):
        setting = NotificationSetting.load()
        if not setting.chat_id:
            return Response(
                {"chat_id": "Pick a WhatsApp chat first."}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            gateway.send(setting.chat_id, "✅ Teste do my-financies — se você recebeu isso, os lembretes vão funcionar.")
        except gateway.GatewayError as e:
            return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({"sent": True})


def _receipt_summary(receipt: Receipt) -> str:
    if receipt.status == Receipt.Status.FAILED or receipt.total_guess is None:
        return (
            "Não consegui ler o valor total dessa foto. Tente outra foto ou registre por "
            "texto (ex: \"gastei 45,50 no mercado\")."
        )
    if receipt.matched_bill:
        lines = [
            f'💳 Parece o pagamento de "{receipt.matched_bill.name}"',
            f"💰 R$ {receipt.total_guess:.2f}".replace(".", ","),
        ]
        if receipt.date_guess:
            lines.append(f"📅 {receipt.date_guess.strftime('%d/%m/%Y')}")
        lines.append("\nResponda ✅ para marcar essa conta como paga ou \"cancelar\" para descartar.")
        return "\n".join(lines)
    lines = []
    if receipt.merchant_guess:
        lines.append(f"🏪 {receipt.merchant_guess}")
    lines.append(f"💰 R$ {receipt.total_guess:.2f}".replace(".", ","))
    if receipt.date_guess:
        lines.append(f"📅 {receipt.date_guess.strftime('%d/%m/%Y')}")
    if receipt.suggested_category:
        lines.append(f"🏷️ {receipt.suggested_category.name}")
    lines.append("\nResponda ✅ para confirmar ou \"cancelar\" para descartar.")
    return "\n".join(lines)


def _get_or_create_wa_conversation() -> Conversation:
    conversation = Conversation.objects.filter(channel="whatsapp").first()
    return conversation or Conversation.objects.create(channel="whatsapp", title="WhatsApp")


def _resolve_spent_by(sender: str) -> str:
    """Maps the gateway's raw sender hint to Expense.SpentBy. "self" is the owner
    (their own linked device); a display name containing PARTNER_WHATSAPP_NAME
    is the partner; anything else (unknown sender, e.g. a third person joins the
    group later) is left unresolved rather than guessed."""
    if sender == "self":
        return Expense.SpentBy.OWNER
    partner = settings.PARTNER_WHATSAPP_NAME.strip().lower()
    if partner and partner in sender.lower():
        return Expense.SpentBy.PARTNER
    return ""


class WaInboundView(APIView):
    """POST target the WhatsApp gateway forwards every inbound message to.
    The gateway is a dumb pipe (forwards everything); this view is what
    decides whether a message belongs to the configured chat and what to do
    with it — text goes to the finance agent (write skills enabled) or
    resolves a pending receipt confirmation; images start the OCR draft flow.
    """

    parser_classes = [MultiPartParser, FormParser, JSONParser]
    authentication_classes = []  # not a browser session — see HasGatewaySecret
    permission_classes = [HasGatewaySecret]

    def post(self, request):
        chat_id = request.data.get("chat_id")
        message_id = request.data.get("message_id")
        if not chat_id or not message_id:
            return Response(
                {"error": "chat_id and message_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        setting = NotificationSetting.load()
        if not setting.enabled or chat_id != setting.chat_id:
            return Response(status=status.HTTP_204_NO_CONTENT)

        _, created = ProcessedWaMessage.objects.get_or_create(wa_message_id=message_id)
        if not created:
            return Response(status=status.HTTP_204_NO_CONTENT)

        spent_by = _resolve_spent_by(request.data.get("sender") or "")

        image = request.FILES.get("image")
        if image:
            reply = self._handle_image(chat_id, message_id, image, spent_by)
        else:
            text = (request.data.get("text") or "").strip()
            if not text:
                return Response(status=status.HTTP_204_NO_CONTENT)
            reply = self._handle_text(chat_id, text, spent_by)

        if reply:
            try:
                gateway.send(chat_id, reply)
            except gateway.GatewayError:
                logger.exception("Failed to send WhatsApp reply to %s", chat_id)

        return Response(status=status.HTTP_204_NO_CONTENT)

    def _handle_image(self, chat_id: str, message_id: str, image, spent_by: str = "") -> str:
        receipt = Receipt.objects.create(
            channel=Receipt.Channel.WHATSAPP,
            wa_chat_id=chat_id,
            wa_message_id=message_id,
            image=image,
            spent_by=spent_by,
        )
        receipt_services.process(receipt)
        if receipt.status == Receipt.Status.PARSED:
            receipt.status = Receipt.Status.AWAITING_CONFIRMATION
            receipt.save(update_fields=["status", "updated_at"])
        return _receipt_summary(receipt)

    def _handle_text(self, chat_id: str, text: str, spent_by: str = "") -> str:
        pending = (
            Receipt.objects.filter(
                channel=Receipt.Channel.WHATSAPP,
                wa_chat_id=chat_id,
                status=Receipt.Status.AWAITING_CONFIRMATION,
            )
            .order_by("-uploaded_at")
            .first()
        )
        normalized = text.strip().lower()
        if pending and normalized in CONFIRM_WORDS:
            return self._confirm_receipt(pending)
        if pending and normalized in CANCEL_WORDS:
            pending.cancel()
            return "Recibo cancelado."

        conversation = _get_or_create_wa_conversation()

        # "desfazer" is a fixed trigger, not free-form text needing interpretation —
        # calling undo_last() directly (instead of routing through the agent) means
        # the reversal is guaranteed to actually happen, rather than depending on a
        # smaller model reliably choosing to call the tool every time (verified
        # during testing: it doesn't, in either direction — sometimes claiming an
        # undo happened without calling the tool, sometimes skipping it and
        # claiming there was nothing to undo).
        if normalized in UNDO_WORDS:
            result = write_tools.undo_last()
            reply = (
                UNDO_REPLY.get(result["kind"], "Desfeito!")
                if result["undone"]
                else "Não há nada para desfazer."
            )
        else:
            history = [
                {"role": m.role, "content": m.content}
                for m in list(conversation.messages.all())[-MAX_HISTORY_MESSAGES:]
            ]
            reply = chat_service.answer(text, history, write_enabled=True, spent_by=spent_by)

        ChatMessage.objects.create(
            conversation=conversation, role=ChatMessage.Role.USER, content=text
        )
        ChatMessage.objects.create(
            conversation=conversation, role=ChatMessage.Role.ASSISTANT, content=reply
        )
        conversation.save()  # bumps updated_at
        return reply

    def _confirm_receipt(self, receipt: Receipt) -> str:
        if receipt.total_guess is None:
            return _receipt_summary(receipt)

        if receipt.matched_bill:
            bill = receipt.matched_bill
            expense = bill.pay()
            update_fields = ["receipt"]
            expense.receipt = receipt
            if receipt.spent_by and expense.spent_by != receipt.spent_by:
                expense.spent_by = receipt.spent_by
                update_fields.append("spent_by")
            expense.save(update_fields=update_fields)
            LastCaptureAction.objects.create(
                kind=LastCaptureAction.Kind.MARK_BILL_PAID, object_id=bill.id
            )
            receipt.status = Receipt.Status.CONFIRMED
            receipt.save(update_fields=["status", "updated_at"])
            return f'✅ Conta "{bill.name}" marcada como paga.'

        merchant = None
        if receipt.merchant_guess:
            merchant, _ = Merchant.objects.get_or_create(
                name=receipt.merchant_guess[:120],
                defaults={"kind": Merchant.Kind.OTHER, "cnpj": receipt.cnpj_guess[:18]},
            )
        category = receipt.suggested_category or Category.objects.filter(slug="uncategorized").first()

        expense = receipt.confirm(
            amount=receipt.total_guess,
            date=receipt.date_guess or timezone.localdate(),
            category=category,
            merchant=merchant,
        )
        if receipt.spent_by and expense.spent_by != receipt.spent_by:
            expense.spent_by = receipt.spent_by
            expense.save(update_fields=["spent_by"])
        return "✅ Despesa registrada."
