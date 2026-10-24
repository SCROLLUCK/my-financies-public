from django.db import models


class Conversation(models.Model):
    """A saved chat thread. Title is auto-set from the first user message."""

    title = models.CharField(max_length=120, blank=True)
    # "" = in-app chat; "whatsapp" = the single WhatsApp-capture thread (hidden
    # from the in-app sidebar, kept only so the agent has multi-turn context).
    channel = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return self.title or f"Conversation {self.pk}"


class ChatMessage(models.Model):
    class Role(models.TextChoices):
        USER = "user", "User"
        ASSISTANT = "assistant", "Assistant"

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=20, choices=Role.choices)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        return f"{self.role}: {self.content[:40]}"


class LastCaptureAction(models.Model):
    """The most recent WhatsApp write skill invocation, so `undo_last` knows
    what to reverse. One row at a time in practice (undo_last deletes it after
    reversing); kept as a plain table rather than a singleton for simplicity."""

    class Kind(models.TextChoices):
        REGISTER_EXPENSE = "register_expense", "Register expense"
        MARK_BILL_PAID = "mark_bill_paid", "Mark bill paid"
        ADD_SHOPPING_ITEM = "add_shopping_item", "Add shopping item"

    kind = models.CharField(max_length=30, choices=Kind.choices)
    object_id = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
