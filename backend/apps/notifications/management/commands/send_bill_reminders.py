from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.bills.models import Bill
from apps.notifications import gateway
from apps.notifications.models import NotificationLog, NotificationSetting


def _format_brl(amount) -> str:
    """1234.56 -> 'R$ 1.234,56' (Decimal has no locale-aware __format__)."""
    swapped = f"{amount:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return f"R$ {swapped}"


class Command(BaseCommand):
    help = "Send WhatsApp reminders for bills inside their configured lead window (idempotent)."

    def handle(self, *args, **options):
        setting = NotificationSetting.load()
        if not setting.enabled:
            self.stdout.write("Notifications disabled — nothing to do.")
            return
        if not setting.chat_id:
            self.stdout.write("No WhatsApp chat configured — nothing to do.")
            return

        try:
            status = gateway.get_status()
        except gateway.GatewayError as e:
            self.stdout.write(self.style.WARNING(f"Gateway unreachable, skipping this run: {e}"))
            return
        if not status.get("connected"):
            self.stdout.write("WhatsApp not linked — nothing to do.")
            return

        today = timezone.localdate()
        sent = 0
        for bill in Bill.objects.filter(status=Bill.Status.PENDING):
            days_until = (bill.due_date - today).days
            is_due_day = days_until == 0 and setting.notify_on_due_day
            if days_until not in setting.lead_days and not is_due_day:
                continue

            lead_offset = days_until
            if NotificationLog.objects.filter(bill=bill, lead_offset=lead_offset).exists():
                continue

            message = (
                f"💳 Lembrete: \"{bill.name}\" vence "
                f"{'hoje' if days_until == 0 else f'em {days_until} dia(s)'} "
                f"({bill.due_date.strftime('%d/%m')}) — {_format_brl(bill.amount)}"
            )
            try:
                gateway.send(setting.chat_id, message)
            except gateway.GatewayError as e:
                NotificationLog.objects.create(
                    bill=bill, lead_offset=lead_offset, status=NotificationLog.Status.FAILED, error=str(e)
                )
                self.stdout.write(self.style.ERROR(f"Failed to notify for bill {bill.id}: {e}"))
                continue

            NotificationLog.objects.create(
                bill=bill, lead_offset=lead_offset, status=NotificationLog.Status.SENT
            )
            sent += 1

        self.stdout.write(self.style.SUCCESS(f"Sent {sent} reminder(s)."))
