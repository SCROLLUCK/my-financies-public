from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from . import service
from .models import ChatMessage, Conversation
from .serializers import ConversationDetailSerializer, ConversationSerializer

# How many prior messages to feed back as context — keeps token usage bounded
# on very long-lived conversations.
MAX_HISTORY_MESSAGES = 40


class ConversationViewSet(viewsets.ModelViewSet):
    # The WhatsApp-capture thread is stored the same way but kept out of the
    # in-app sidebar — it's just persisted context for the agent, not a chat
    # the user has with themselves in the browser.
    queryset = Conversation.objects.exclude(channel="whatsapp")
    http_method_names = ["get", "delete"]

    def get_serializer_class(self):
        return ConversationDetailSerializer if self.action == "retrieve" else ConversationSerializer


class ChatView(APIView):
    """POST {message, conversation_id?} -> {reply, conversation_id, title}.
    Persists both sides of the exchange to a Conversation so history survives
    reloads and past conversations can be reopened."""

    def post(self, request):
        message = (request.data.get("message") or "").strip()
        if not message:
            return Response({"message": "Message is required."}, status=status.HTTP_400_BAD_REQUEST)
        if len(message) > 2000:
            return Response({"message": "Message is too long."}, status=status.HTTP_400_BAD_REQUEST)

        conversation_id = request.data.get("conversation_id")
        if conversation_id:
            conversation = Conversation.objects.filter(pk=conversation_id).first()
            if conversation is None:
                return Response(
                    {"conversation_id": "Unknown conversation."}, status=status.HTTP_400_BAD_REQUEST
                )
        else:
            conversation = Conversation.objects.create()

        history = [
            {"role": m.role, "content": m.content}
            for m in list(conversation.messages.all())[-MAX_HISTORY_MESSAGES:]
        ]

        reply = service.answer(message, history)

        ChatMessage.objects.create(conversation=conversation, role=ChatMessage.Role.USER, content=message)
        ChatMessage.objects.create(
            conversation=conversation, role=ChatMessage.Role.ASSISTANT, content=reply
        )
        if not conversation.title:
            conversation.title = message[:80]
        conversation.save()  # also bumps updated_at, keeping the list sorted by activity

        return Response(
            {"reply": reply, "conversation_id": conversation.id, "title": conversation.title}
        )
