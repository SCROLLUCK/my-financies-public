from django.core.management.base import BaseCommand

from apps.bills.services import generate_bills


class Command(BaseCommand):
    help = "Generate Bills for active recurring expenses for a given month (default: current)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--month", help="Target month as YYYY-MM (defaults to the current month)."
        )

    def handle(self, *args, **options):
        created = generate_bills(options.get("month"))
        self.stdout.write(self.style.SUCCESS(f"Generated {created} bill(s)."))
