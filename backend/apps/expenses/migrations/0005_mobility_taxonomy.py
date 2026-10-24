from django.db import migrations

# Vehicle topic becomes Mobility; the Insurance category becomes a general
# "Vehicle" category (insurance, taxes, financing); adds ride-hailing/transit.


def forward(apps, schema_editor):
    Topic = apps.get_model("expenses", "Topic")
    Category = apps.get_model("expenses", "Category")

    topic = Topic.objects.filter(slug="vehicle").first()
    if topic:
        topic.name = "Mobility"
        topic.slug = "mobility"
        topic.save(update_fields=["name", "slug"])
    else:
        topic = Topic.objects.filter(slug="mobility").first()

    if topic is None:
        return

    insurance = Category.objects.filter(slug="insurance", topic=topic).first()
    if insurance:
        insurance.name = "Vehicle"
        insurance.slug = "vehicle"
        insurance.aliases = ["seguro", "ipva", "financiamento", "veiculo"]
        insurance.save(update_fields=["name", "slug", "aliases"])

    Category.objects.get_or_create(
        slug="ride-hailingtransit",
        defaults={
            "name": "Ride-hailing/Transit",
            "topic": topic,
            "aliases": ["uber", "99", "onibus", "metro", "transporte"],
        },
    )


def backward(apps, schema_editor):
    Topic = apps.get_model("expenses", "Topic")
    Category = apps.get_model("expenses", "Category")

    Category.objects.filter(slug="ride-hailingtransit").delete()
    vehicle_cat = Category.objects.filter(slug="vehicle").first()
    if vehicle_cat:
        vehicle_cat.name = "Insurance"
        vehicle_cat.slug = "insurance"
        vehicle_cat.aliases = ["seguro"]
        vehicle_cat.save(update_fields=["name", "slug", "aliases"])
    topic = Topic.objects.filter(slug="mobility").first()
    if topic:
        topic.name = "Vehicle"
        topic.slug = "vehicle"
        topic.save(update_fields=["name", "slug"])


class Migration(migrations.Migration):

    dependencies = [
        ("expenses", "0004_seed_education"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
