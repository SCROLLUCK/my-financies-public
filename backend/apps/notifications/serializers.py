from rest_framework import serializers

from .models import NotificationSetting


class NotificationSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationSetting
        fields = [
            "enabled",
            "chat_id",
            "chat_name",
            "lead_days",
            "notify_on_due_day",
        ]
