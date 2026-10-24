from django.db.models import Count, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.expenses.models import Category, Expense

from .models import StatementImport, StatementTransaction
from .parsers import parse_csv, parse_ofx, suggest_categories
from .serializers import (
    MAX_UPLOAD_BYTES,
    StatementImportListSerializer,
    StatementImportSerializer,
)


class StatementImportViewSet(viewsets.ModelViewSet):
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ["get", "post", "delete"]

    def get_queryset(self):
        return StatementImport.objects.annotate(
            pending_count=Count(
                "transactions",
                filter=Q(transactions__status=StatementTransaction.Status.PENDING),
            )
        )

    def get_serializer_class(self):
        if self.action == "list":
            return StatementImportListSerializer
        return StatementImportSerializer

    def retrieve(self, request, *args, **kwargs):
        # Suggestions are stored at parse time; recompute for pending lines so
        # taxonomy/alias updates apply without re-importing the file.
        statement = self.get_object()
        pending = list(statement.transactions.filter(
            status=StatementTransaction.Status.PENDING
        ))
        dicts = [{"name": t.name, "memo": t.memo} for t in pending]
        suggest_categories(dicts)
        for tx, parsed in zip(pending, dicts):
            new = parsed["suggested_category"]
            new_id = new.pk if new else None
            if tx.suggested_category_id != new_id:
                tx.suggested_category = new
                tx.save(update_fields=["suggested_category"])
        return super().retrieve(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"file": "Send an .ofx or .csv file."}, status=400)
        if upload.size > MAX_UPLOAD_BYTES:
            return Response({"file": "File larger than 5MB."}, status=400)

        name = upload.name or ""
        lowered = name.lower()
        if lowered.endswith(".ofx"):
            file_format = StatementImport.Format.OFX
        elif lowered.endswith(".csv"):
            file_format = StatementImport.Format.CSV
        else:
            return Response({"file": "Only .ofx and .csv are supported."}, status=400)

        raw = upload.read()
        upload.seek(0)
        parsed = parse_ofx(raw) if file_format == "ofx" else parse_csv(raw)
        transactions = parsed["transactions"]
        if not transactions:
            return Response(
                {"file": "No transactions found in this file."}, status=400
            )
        suggest_categories(transactions)

        statement = StatementImport.objects.create(
            file=upload,
            original_name=name[:255],
            format=file_format,
            bank=parsed["bank"][:120],
        )

        existing = set(
            StatementTransaction.objects.filter(
                fitid__in=[tx["fitid"] for tx in transactions]
            ).values_list("fitid", flat=True)
        )
        created = 0
        duplicates = 0
        seen: set[str] = set()
        for tx in transactions:
            if tx["fitid"] in existing or tx["fitid"] in seen:
                duplicates += 1
                continue
            seen.add(tx["fitid"])
            StatementTransaction.objects.create(
                statement=statement,
                fitid=tx["fitid"],
                date=tx["date"],
                amount=tx["amount"],
                direction=tx["direction"],
                name=tx["name"],
                memo=tx["memo"],
                suggested_category=tx["suggested_category"],
            )
            created += 1

        statement.transactions_found = created
        statement.duplicates_skipped = duplicates
        statement.save(update_fields=["transactions_found", "duplicates_skipped"])

        serializer = StatementImportSerializer(statement)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        """Import selected lines: items=[{transaction_id, category_id?, description?,
        link_expense_id?}].

        Debits require a category and become Expenses, unless link_expense_id
        is set — then the line is marked accounted-for by that existing
        expense instead of creating a duplicate. Credits become Incomes.
        """
        statement = self.get_object()
        items = request.data.get("items") or []
        if not isinstance(items, list) or not items:
            return Response({"items": "Send a non-empty items list."}, status=400)

        imported = []
        for item in items:
            tx = StatementTransaction.objects.filter(
                pk=item.get("transaction_id"), statement=statement
            ).first()
            if tx is None:
                return Response(
                    {"items": f"Unknown transaction {item.get('transaction_id')}."},
                    status=400,
                )
            description = (item.get("description") or "").strip()
            if tx.direction == StatementTransaction.Direction.IN:
                income = tx.import_as_income(description=description)
                imported.append({"transaction_id": tx.pk, "income_id": income.pk})
                continue
            if link_expense_id := item.get("link_expense_id"):
                expense = Expense.objects.filter(pk=link_expense_id).first()
                if expense is None:
                    return Response(
                        {"items": f"Transaction {tx.pk}: unknown expense to link."},
                        status=400,
                    )
                tx.link_to_expense(expense)
                imported.append({"transaction_id": tx.pk, "expense_id": expense.pk})
                continue
            category = Category.objects.filter(pk=item.get("category_id")).first()
            if category is None:
                return Response(
                    {"items": f"Transaction {tx.pk}: pick a category."}, status=400
                )
            expense = tx.import_as_expense(category=category, description=description)
            imported.append({"transaction_id": tx.pk, "expense_id": expense.pk})

        return Response({"imported": imported})

    @action(detail=True, methods=["post"])
    def skip(self, request, pk=None):
        """Mark transactions as skipped: ids=[...]. Without ids, skips all pending."""
        statement = self.get_object()
        qs = statement.transactions.filter(status=StatementTransaction.Status.PENDING)
        if ids := request.data.get("ids"):
            qs = qs.filter(pk__in=ids)
        updated = qs.update(status=StatementTransaction.Status.SKIPPED)
        return Response({"skipped": updated})
