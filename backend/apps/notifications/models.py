from django.db import models


class NotificationSetting(models.Model):
    """Singleton row (pk=1) holding WhatsApp notification config."""

    enabled = models.BooleanField(default=False)
    # One chat for everything WhatsApp-related: reminders are sent here, and
    # (Phase 5b) it's also the chat watched for receipt/quick-add capture.
    # Populated by picking from the gateway's chat list (see notifications.gateway) —
    # a JID, so it can be a DM (@s.whatsapp.net) or a group (@g.us).
    chat_id = models.CharField(max_length=100, blank=True)
    chat_name = models.CharField(max_length=120, blank=True)
    # Days-before-due to send a reminder, e.g. [7, 3, 1].
    lead_days = models.JSONField(default=list)
    notify_on_due_day = models.BooleanField(default=True)

    @classmethod
    def load(cls) -> "NotificationSetting":
        obj, created = cls.objects.get_or_create(pk=1, defaults={"lead_days": [7, 3, 1]})
        return obj


class NotificationLog(models.Model):
    """One row per (bill, lead_offset) reminder actually attempted — the
    idempotency guard so a daily re-run never double-sends."""

    class Status(models.TextChoices):
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"

    bill = models.ForeignKey(
        "bills.Bill", on_delete=models.CASCADE, related_name="notification_logs"
    )
    # Days before due_date (0 = due-day reminder).
    lead_offset = models.IntegerField()
    status = models.CharField(max_length=20, choices=Status.choices)
    error = models.TextField(blank=True)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("bill", "lead_offset")
        ordering = ["-sent_at"]

    def __str__(self) -> str:
        return f"{self.bill_id} lead={self.lead_offset} ({self.status})"


class ProcessedWaMessage(models.Model):
    """Idempotency gate for /api/wa/inbound/ — a re-delivered message (Baileys
    resends on flaky reconnects) is ignored rather than processed twice."""

    wa_message_id = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
