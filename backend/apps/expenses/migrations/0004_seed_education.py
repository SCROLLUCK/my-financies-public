from django.db import migrations
from django.utils.text import slugify

# Same structure as 0002: Topic → (color, is_food, [ (category_name, [aliases]) ])
SEED = [
    ("Education", "#f76707", False, [
        ("College", ["faculdade", "universidade", "mensalidade faculdade"]),
        ("Courses", ["curso", "cursos", "udemy", "alura"]),
        ("Books", ["livro", "livros"]),
        ("School supplies", ["material escolar", "papelaria"]),
    ]),
]


def seed(apps, schema_editor):
    Topic = apps.get_model("expenses", "Topic")
    Category = apps.get_model("expenses", "Category")

    # Insert before "Other" so it stays last in the nav ordering.
    other = Topic.objects.filter(slug="other").first()
    order = other.order if other else Topic.objects.count()
    for topic_name, color, is_food, categories in SEED:
        topic, created = Topic.objects.get_or_create(
            slug=slugify(topic_name),
            defaults={
                "name": topic_name,
                "color": color,
                "is_food": is_food,
                "order": order,
            },
        )
        if created and other:
            other.order = order + 1
            other.save(update_fields=["order"])
        order += 1
        for cat_name, aliases in categories:
            Category.objects.get_or_create(
                slug=slugify(cat_name),
                defaults={"name": cat_name, "topic": topic, "aliases": aliases},
            )


def unseed(apps, schema_editor):
    Topic = apps.get_model("expenses", "Topic")
    Category = apps.get_model("expenses", "Category")
    cat_slugs = [slugify(cat) for _, _, _, cats in SEED for cat, _ in cats]
    Category.objects.filter(slug__in=cat_slugs).delete()
    Topic.objects.filter(slug__in=[slugify(name) for name, _, _, _ in SEED]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("expenses", "0003_alter_expense_options_remove_expense_date_and_more"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
