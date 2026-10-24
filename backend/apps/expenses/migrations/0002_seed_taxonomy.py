from django.db import migrations
from django.utils.text import slugify

# Topic → (color, is_food, [ (category_name, [aliases]) ])
SEED = [
    ("Food", "#f59f00", True, [
        ("Groceries", ["mercado", "supermercado", "feira", "carrefour"]),
        ("Restaurant", ["restaurante", "almoco", "jantar"]),
        ("iFood/Delivery", ["ifood", "delivery", "rappi", "uber eats"]),
        ("Snacks", ["lanche", "padaria"]),
    ]),
    ("Hygiene", "#15aabf", False, [
        ("Toiletries", ["higiene", "shampoo", "sabonete"]),
        ("Cleaning supplies", ["limpeza", "detergente"]),
    ]),
    ("Aesthetics", "#e64980", False, [
        ("Haircut", ["cabelo", "barbearia", "salao"]),
        ("Skincare", ["skincare", "pele"]),
        ("Nails", ["unha", "manicure"]),
        ("Cosmetics", ["maquiagem", "cosmetico"]),
    ]),
    ("Health", "#40c057", False, [
        ("Pharmacy", ["farmacia", "remedio", "drogaria"]),
        ("Doctor", ["medico", "consulta"]),
        ("Dental", ["dentista"]),
        ("Gym", ["academia", "gym"]),
    ]),
    ("Vehicle", "#4263eb", False, [
        ("Fuel", ["gasolina", "combustivel", "posto", "etanol"]),
        ("Maintenance", ["manutencao", "oficina", "mecanico"]),
        ("Insurance", ["seguro"]),
        ("Parking", ["estacionamento"]),
        ("Tolls", ["pedagio"]),
    ]),
    ("Leisure & entertainment", "#7950f2", False, [
        ("Streaming", ["netflix", "spotify", "streaming", "disney"]),
        ("Bars", ["bar", "cerveja", "balada"]),
        ("Travel", ["viagem", "hotel", "passagem"]),
        ("Games", ["jogo", "game", "steam"]),
        ("Events", ["show", "cinema", "evento"]),
    ]),
    ("Housing", "#fa5252", False, [
        ("Rent", ["aluguel"]),
        ("Condo", ["condominio"]),
        ("Utilities", ["luz", "energia", "agua", "gas"]),
        ("Internet", ["internet", "wifi"]),
        ("Furniture", ["movel", "moveis"]),
    ]),
    ("Subscriptions", "#12b886", False, [
        ("Software", ["software", "app", "assinatura"]),
        ("Memberships", ["mensalidade", "clube"]),
    ]),
    ("Other", "#868e96", False, [
        ("Uncategorized", []),
    ]),
]


def seed(apps, schema_editor):
    Topic = apps.get_model("expenses", "Topic")
    Category = apps.get_model("expenses", "Category")

    for order, (topic_name, color, is_food, categories) in enumerate(SEED):
        topic, _ = Topic.objects.get_or_create(
            slug=slugify(topic_name),
            defaults={
                "name": topic_name,
                "color": color,
                "is_food": is_food,
                "order": order,
            },
        )
        for cat_name, aliases in categories:
            Category.objects.get_or_create(
                slug=slugify(cat_name),
                defaults={"name": cat_name, "topic": topic, "aliases": aliases},
            )


def unseed(apps, schema_editor):
    Topic = apps.get_model("expenses", "Topic")
    Category = apps.get_model("expenses", "Category")
    Category.objects.all().delete()
    Topic.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("expenses", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
