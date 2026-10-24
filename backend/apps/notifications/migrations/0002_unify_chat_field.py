from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0001_initial"),
    ]

    operations = [
        migrations.RenameField(
            model_name="notificationsetting",
            old_name="ingest_chat_id",
            new_name="chat_id",
        ),
        migrations.RenameField(
            model_name="notificationsetting",
            old_name="ingest_chat_name",
            new_name="chat_name",
        ),
        migrations.RemoveField(
            model_name="notificationsetting",
            name="reminder_phone",
        ),
    ]
