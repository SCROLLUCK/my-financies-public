import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { LineChart } from "@mantine/charts";
import { useForm } from "@mantine/form";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconPlus, IconTag } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { formatBRL, formatDate, toYMD } from "../../lib/format";
import { CategoryPicker } from "../../components/CategoryPicker";
import type {
  Category,
  Merchant,
  PriceObservation,
  Product,
  ProductPriceSummary,
} from "../../api/types";

const LINE_COLORS = ["teal.6", "orange.6", "grape.6", "blue.6", "red.6", "lime.6"];

export function PricesPage() {
  const { t } = useTranslation();
  const [productId, setProductId] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productOpened, productModal] = useDisclosure(false);
  const [priceOpened, priceModal] = useDisclosure(false);
  const qc = useQueryClient();
  const isMobile = useMediaQuery("(max-width: 48em)");

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get<Product[]>("/products/"),
  });

  const { data: merchants } = useQuery({
    queryKey: ["merchants"],
    queryFn: () => api.get<Merchant[]>("/merchants/"),
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories/"),
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["product-summary", productId],
    queryFn: () =>
      api.get<ProductPriceSummary>(`/products/${productId}/price-summary/`),
    enabled: !!productId,
  });

  const { data: history } = useQuery({
    queryKey: ["price-observations", productId],
    queryFn: () =>
      api.get<PriceObservation[]>(`/price-observations/?product=${productId}`),
    enabled: !!productId,
  });

  const productForm = useForm({
    initialValues: {
      name: "",
      unit: "",
      topic_id: "" as string,
      category_id: "" as string,
    },
    validate: { name: (v) => (v.trim() ? null : t("prices.errName")) },
  });

  const openCreateProduct = () => {
    setEditingProduct(null);
    productForm.reset();
    productModal.open();
  };

  const openEditProduct = (p: Product) => {
    setEditingProduct(p);
    productForm.setValues({
      name: p.name,
      unit: p.unit,
      topic_id: p.category ? String(p.category.topic.id) : "",
      category_id: p.category ? String(p.category.id) : "",
    });
    productModal.open();
  };

  const saveProductMutation = useMutation({
    mutationFn: (values: typeof productForm.values) => {
      const payload = {
        name: values.name,
        unit: values.unit,
        category_id: values.category_id ? Number(values.category_id) : null,
      };
      return editingProduct
        ? api.patch<Product>(`/products/${editingProduct.id}/`, payload)
        : api.post<Product>("/products/", payload);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-summary"] });
      notifications.show({
        message: t(editingProduct ? "prices.productUpdated" : "prices.productAdded"),
        color: "teal",
      });
      productForm.reset();
      productModal.close();
      setProductId(String(saved.id));
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const priceForm = useForm({
    initialValues: {
      merchant_id: "" as string,
      new_store: "",
      price: "" as string | number,
      date: new Date(),
    },
    validate: {
      price: (v) => (Number(v) > 0 ? null : t("prices.errPrice")),
      merchant_id: (v, values) =>
        v || values.new_store.trim() ? null : t("prices.errStore"),
    },
  });

  const logPriceMutation = useMutation({
    mutationFn: async (values: typeof priceForm.values) => {
      let merchantId = Number(values.merchant_id);
      if (values.new_store.trim()) {
        const merchant = await api.post<Merchant>("/merchants/", {
          name: values.new_store.trim(),
          kind: "grocery",
        });
        merchantId = merchant.id;
      }
      return api.post<PriceObservation>("/price-observations/", {
        product_id: Number(productId),
        merchant_id: merchantId,
        price: String(values.price),
        date: toYMD(values.date),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-summary"] });
      qc.invalidateQueries({ queryKey: ["price-observations"] });
      qc.invalidateQueries({ queryKey: ["merchants"] });
      qc.invalidateQueries({ queryKey: ["shopping-list-items"] });
      notifications.show({ message: t("prices.priceLogged"), color: "teal" });
      priceForm.reset();
      priceModal.close();
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const productOptions = (products ?? []).map((p) => ({
    value: String(p.id),
    label: p.unit ? `${p.name} (${p.unit})` : p.name,
  }));

  const merchantOptions = (merchants ?? []).map((m) => ({
    value: String(m.id),
    label: m.name,
  }));

  // Pivot history into one row per date with a column per store.
  const stores = Array.from(new Set((history ?? []).map((o) => o.merchant.name)));
  const byDate = new Map<string, Record<string, string | number>>();
  for (const obs of [...(history ?? [])].reverse()) {
    const row = byDate.get(obs.date) ?? { date: formatDate(obs.date) };
    row[obs.merchant.name] = Number(obs.price);
    byDate.set(obs.date, row);
  }
  const chartRows = Array.from(byDate.values());
  const chartSeries = stores.map((name, i) => ({
    name,
    color: LINE_COLORS[i % LINE_COLORS.length],
  }));

  return (
    <Stack gap="lg">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Title order={2}>{t("prices.title")}</Title>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
          <Select
            placeholder={t("prices.selectProduct")}
            searchable
            clearable
            data={productOptions}
            value={productId}
            onChange={setProductId}
            w={{ base: "100%", sm: 260 }}
          />
          <Button
            variant="light"
            leftSection={<IconPlus size={16} />}
            onClick={openCreateProduct}
            w={{ base: "100%", sm: "auto" }}
          >
            {t("prices.addProduct")}
          </Button>
        </div>
      </div>

      {!products || !products.length ? (
        <Text c="dimmed">{t("prices.noProducts")}</Text>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("prices.colProduct")}</Table.Th>
              <Table.Th ta="right">{t("prices.colLowest")}</Table.Th>
              <Table.Th>{t("prices.colLatestDate")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {products.map((p) => (
              <Table.Tr
                key={p.id}
                onClick={() => setProductId(String(p.id))}
                bg={productId === String(p.id) ? "var(--mantine-color-teal-light)" : undefined}
                style={{ cursor: "pointer" }}
              >
                <Table.Td>
                  {p.name}
                  {p.unit ? ` (${p.unit})` : ""}
                </Table.Td>
                <Table.Td ta="right">
                  {p.cheapest_price ? (
                    formatBRL(p.cheapest_price)
                  ) : (
                    <Text span c="dimmed" size="sm">
                      {t("prices.noPriceYet")}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{p.last_price_date ? formatDate(p.last_price_date) : "—"}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {productId && (summaryLoading || !summary ? (
        <Loader />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Group gap="xs">
              <Title order={4}>
                {summary.product.name}
                {summary.product.unit ? ` (${summary.product.unit})` : ""}
              </Title>
              <ActionIcon
                variant="subtle"
                onClick={() => openEditProduct(summary.product)}
              >
                <IconPencil size={16} />
              </ActionIcon>
            </Group>
            <Button
              leftSection={<IconTag size={16} />}
              onClick={priceModal.open}
              w={{ base: "100%", sm: "auto" }}
            >
              {t("prices.logPrice")}
            </Button>
          </div>

          {summary.by_store.length ? (
            <>
            <div className="grid grid-cols-1 gap-2 md:hidden">
              {summary.by_store.map((row) => (
                <Paper key={row.merchant.id} withBorder radius="md" p="sm">
                  <div className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-1">
                    <Text size="sm" fw={600}>{row.merchant.name}</Text>
                    <Text size="sm" fw={600}>{formatBRL(row.latest_price)}</Text>
                    <Text size="xs" c="dimmed" className="col-span-2">
                      {t("prices.colLatestDate")}: {formatDate(row.latest_date)} ·{" "}
                      {t("prices.colLowest")}: {formatBRL(row.lowest_price)}
                    </Text>
                    {summary.cheapest?.merchant_id === row.merchant.id && (
                      <Badge color="teal" variant="light" className="col-span-2 justify-self-start">
                        {t("prices.cheapest")}
                      </Badge>
                    )}
                  </div>
                </Paper>
              ))}
            </div>
            <Table highlightOnHover className="hidden md:table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("prices.colStore")}</Table.Th>
                  <Table.Th ta="right">{t("prices.colLatest")}</Table.Th>
                  <Table.Th>{t("prices.colLatestDate")}</Table.Th>
                  <Table.Th ta="right">{t("prices.colLowest")}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {summary.by_store.map((row) => (
                  <Table.Tr key={row.merchant.id}>
                    <Table.Td>{row.merchant.name}</Table.Td>
                    <Table.Td ta="right">{formatBRL(row.latest_price)}</Table.Td>
                    <Table.Td>{formatDate(row.latest_date)}</Table.Td>
                    <Table.Td ta="right">{formatBRL(row.lowest_price)}</Table.Td>
                    <Table.Td>
                      {summary.cheapest?.merchant_id === row.merchant.id && (
                        <Badge color="teal" variant="light">
                          {t("prices.cheapest")}
                        </Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </>
          ) : (
            <Text c="dimmed">{t("prices.noPrices")}</Text>
          )}

          {chartRows.length > 1 && (
            <Card withBorder padding="lg" radius="md">
              <Title order={4} mb="md">
                {t("prices.history")}
              </Title>
              <LineChart
                h={240}
                data={chartRows}
                dataKey="date"
                series={chartSeries}
                connectNulls
                curveType="linear"
                valueFormatter={formatBRL}
                yAxisProps={{ width: isMobile ? 64 : 80 }}
                tooltipAnimationDuration={150}
              />
            </Card>
          )}
        </>
      ))}

      <Modal
        opened={productOpened}
        onClose={productModal.close}
        title={t(editingProduct ? "prices.editProduct" : "prices.addProduct")}
      >
        <form
          onSubmit={productForm.onSubmit((v) => saveProductMutation.mutate(v))}
        >
          <Stack>
            <TextInput
              label={t("prices.name")}
              placeholder="Milk, whole"
              {...productForm.getInputProps("name")}
            />
            <TextInput
              label={t("prices.unit")}
              placeholder="1L, 1kg, un"
              {...productForm.getInputProps("unit")}
            />
            <CategoryPicker
              categories={categories}
              topicId={productForm.values.topic_id}
              categoryId={productForm.values.category_id}
              onTopicChange={(v) => productForm.setFieldValue("topic_id", v)}
              onCategoryChange={(v) => productForm.setFieldValue("category_id", v)}
            />
            <Button type="submit" loading={saveProductMutation.isPending}>
              {t("common.save")}
            </Button>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={priceOpened}
        onClose={priceModal.close}
        title={t("prices.logPrice")}
      >
        <form onSubmit={priceForm.onSubmit((v) => logPriceMutation.mutate(v))}>
          <Stack>
            <Select
              label={t("prices.store")}
              searchable
              clearable
              data={merchantOptions}
              {...priceForm.getInputProps("merchant_id")}
            />
            <TextInput
              label={t("prices.orNewStore")}
              {...priceForm.getInputProps("new_store")}
            />
            <NumberInput
              label={t("prices.price")}
              decimalScale={2}
              fixedDecimalScale
              min={0}
              {...priceForm.getInputProps("price")}
            />
            <DatePickerInput
              label={t("prices.date")}
              valueFormat="DD/MM/YYYY"
              {...priceForm.getInputProps("date")}
            />
            <Button type="submit" loading={logPriceMutation.isPending}>
              {t("common.save")}
            </Button>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
