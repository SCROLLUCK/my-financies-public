from django.db import migrations


def migrate_salary(apps, schema_editor):
    AppSettings = apps.get_model("core", "AppSettings")
    IncomeSource = apps.get_model("bills", "IncomeSource")
    settings = AppSettings.objects.filter(pk=1).first()
    if settings and settings.monthly_salary and settings.monthly_salary > 0:
        IncomeSource.objects.create(
            name="Salário", amount=settings.monthly_salary, end_date=None
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0001_initial"),
        ("bills", "0004_incomesource"),
    ]

    operations = [
        migrations.RunPython(migrate_salary, noop_reverse),
        migrations.DeleteModel(name="AppSettings"),
    ]
