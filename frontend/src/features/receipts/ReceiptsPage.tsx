import { useState } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  FileButton,
  Group,
  Image,
  Loader,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconCamera, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { confirmDelete } from "../../lib/confirmDelete";
import { formatBRL, formatDate, formatDateTime, toYMD } from "../../lib/format";
import { CategoryPicker } from "../../components/CategoryPicker";
import type {
  Category,
  Merchant,
  Product,
  Receipt,
  ReceiptLineItem,
} from "../../api/types";

const STATUS_COLORS: Record<Receipt["status"], string> = {
  uploaded: "gray",
  parsed: "yellow",
  awaiting_confirmation: "yellow",
  confirmed: "teal",
  cancelled: "gray",
  failed: "red",
};

interface PriceCapture {
  enabled: boolean;
  product_id: string | null;
  product_name: string;
  price: string;
}

function defaultCapture(
  item: ReceiptLineItem,
  existing: PriceCapture | undefined
): PriceCapture {
  return (
    existing ?? {
      enabled: false,
      product_id: null,
      product_name: item.description,
      price: item.unit_price ?? item.total_price ?? "",
    }
  );
}

export function ReceiptsPage() {
  const { t } = useTranslation();
  const [reviewing, setReviewing] = useState<Receipt | null>(null);
  const [priceCaptures, setPriceCaptures] = useState<Record<number, PriceCapture>>({});
  const qc = useQueryClient();

  const { data: receipts, isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: () => api.get<Receipt[]>("/receipts/"),
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories/"),
  });

  const { data: merchants } = useQuery({
    queryKey: ["merchants"],
    queryFn: () => api.get<Merchant[]>("/merchants/"),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get<Product[]>("/products/"),
  });

  const form = useForm({
    initialValues: {
      amount: "" as string | number,
      date: new Date(),
      topic_id: "" as string,
      category_id: "" as string,
      merchant_id: "" as string,
      merchant_name: "",
      description: "",
    },
    validate: {
      amount: (v) => (Number(v) > 0 ? null : t("receipts.errAmount")),
      category_id: (v) => (v ? null : t("receipts.errCategory")),
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("image", file);
      return api.upload<Receipt>("/receipts/", formData);
    },
    onSuccess: (receipt) => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
      notifications.show({
        message: t(
          receipt.status === "failed" ? "receipts.uploadFailed" : "receipts.uploaded"
        ),
        color: receipt.status === "failed" ? "red" : "teal",
      });
      if (receipt.status === "parsed") openReview(receipt);
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const confirmMutation = useMutation({
    mutationFn: (values: typeof form.values) => {
      const price_items = Object.values(priceCaptures)
        .filter(
          (c) =>
            c.enabled &&
            Number(c.price) > 0 &&
            (c.product_id || c.product_name.trim())
        )
        .map((c) =>
          c.product_id
            ? { product_id: Number(c.product_id), price: String(c.price) }
            : { product_name: c.product_name.trim(), price: String(c.price) }
        );
      return api.post<Receipt>(`/receipts/${reviewing!.id}/confirm/`, {
        amount: String(values.amount),
        date: toYMD(values.date),
        category_id: Number(values.category_id),
        ...(values.merchant_id
          ? { merchant_id: Number(values.merchant_id) }
          : values.merchant_name.trim()
            ? { merchant_name: values.merchant_name.trim() }
            : {}),
        description: values.description,
        price_items,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["food"] });
      qc.invalidateQueries({ queryKey: ["merchants"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["price-observations"] });
      qc.invalidateQueries({ queryKey: ["product-summary"] });
      notifications.show({ message: t("receipts.confirmed"), color: "teal" });
      setReviewing(null);
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => api.post<Receipt>(`/receipts/${id}/cancel/`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
      setReviewing(null);
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const reprocessMutation = useMutation({
    mutationFn: (id: number) => api.post<Receipt>(`/receipts/${id}/reprocess/`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
      notifications.show({ message: t("receipts.reprocessed"), color: "teal" });
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del(`/receipts/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["receipts"] }),
  });

  const openReview = (receipt: Receipt) => {
    setReviewing(receipt);
    setPriceCaptures({});
    form.setValues({
      amount: receipt.total_guess ?? "",
      date: receipt.date_guess
        ? new Date(`${receipt.date_guess}T00:00:00`)
        : new Date(),
      topic_id: receipt.suggested_category
        ? String(receipt.suggested_category.topic.id)
        : "",
      category_id: receipt.suggested_category
        ? String(receipt.suggested_category.id)
        : "",
      merchant_id: "",
      merchant_name: receipt.merchant_guess,
      description: receipt.merchant_guess,
    });
  };

  const merchantOptions = (merchants ?? []).map((m) => ({
    value: String(m.id),
    label: m.name,
  }));
  const productOptions = (products ?? []).map((p) => ({
    value: String(p.id),
    label: p.unit ? `${p.name} (${p.unit})` : p.name,
  }));

  const merchantChosen =
    !!form.values.merchant_id || !!form.values.merchant_name.trim();

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>{t("receipts.title")}</Title>
        <FileButton
          onChange={(file) => file && uploadMutation.mutate(file)}
          accept="image/*"
        >
          {(props) => (
            <Button
              {...props}
              leftSection={<IconCamera size={16} />}
              loading={uploadMutation.isPending}
            >
              {t("receipts.upload")}
            </Button>
          )}
        </FileButton>
      </Group>

      {uploadMutation.isPending && (
        <Text c="dimmed" size="sm">
          {t("receipts.processing")}
        </Text>
      )}

      {isLoading ? (
        <Loader />
      ) : receipts && receipts.length ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {receipts.map((r) => (
            <Card key={r.id} withBorder padding="md" radius="md">
              <Group align="flex-start" wrap="nowrap">
                <Anchor href={r.image} target="_blank">
                  <Image src={r.image} w={72} h={96} fit="cover" radius="sm" />
                </Anchor>
                <Stack gap={4} style={{ flex: 1 }}>
                  <Group justify="space-between">
                    <Badge variant="light" color={STATUS_COLORS[r.status]}>
                      {t(`receipts.status_${r.status}`)}
                    </Badge>
                    <Group gap={4}>
                      {(r.status === "failed" || r.status === "parsed") && (
                        <ActionIcon
                          variant="subtle"
                          onClick={() => reprocessMutation.mutate(r.id)}
                          title={t("receipts.reprocess")}
                        >
                          <IconRefresh size={16} />
                        </ActionIcon>
                      )}
                      {r.status !== "confirmed" && (
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() =>
                            confirmDelete(
                              t,
                              t("common.deleteItemConfirm", {
                                name: r.merchant_guess || t("receipts.unknownMerchant"),
                              }),
                              () => deleteMutation.mutate(r.id)
                            )
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      )}
                    </Group>
                  </Group>
                  <Text fw={600} lineClamp={1}>
                    {r.merchant_guess || t("receipts.unknownMerchant")}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {r.total_guess ? formatBRL(r.total_guess) : "—"}
                    {r.date_guess ? ` · ${formatDate(r.date_guess)}` : ""}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {formatDateTime(r.uploaded_at)}
                  </Text>
                  {(r.status === "parsed" ||
                    r.status === "awaiting_confirmation") && (
                    <Button size="compact-sm" onClick={() => openReview(r)}>
                      {t("receipts.review")}
                    </Button>
                  )}
                </Stack>
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      ) : (
        <Text c="dimmed">{t("receipts.none")}</Text>
      )}

      <Modal
        opened={!!reviewing}
        onClose={() => setReviewing(null)}
        title={t("receipts.reviewTitle")}
        size="xl"
      >
        {reviewing && (
          <Group align="flex-start" wrap="nowrap" gap="lg">
            <form
              onSubmit={form.onSubmit((v) => confirmMutation.mutate(v))}
              style={{ flex: 1 }}
            >
              <Stack gap="sm">
                <NumberInput
                  label={t("receipts.amount")}
                  decimalScale={2}
                  fixedDecimalScale
                  min={0}
                  {...form.getInputProps("amount")}
                />
                <DatePickerInput
                  label={t("receipts.date")}
                  valueFormat="DD/MM/YYYY"
                  {...form.getInputProps("date")}
                />
                <CategoryPicker
                  categories={categories}
                  topicId={form.values.topic_id}
                  categoryId={form.values.category_id}
                  onTopicChange={(v) => form.setFieldValue("topic_id", v)}
                  onCategoryChange={(v) => form.setFieldValue("category_id", v)}
                  error={form.errors.category_id}
                />
                <Select
                  label={t("receipts.merchant")}
                  searchable
                  clearable
                  data={merchantOptions}
                  {...form.getInputProps("merchant_id")}
                />
                <TextInput
                  label={t("receipts.orNewMerchant")}
                  disabled={!!form.values.merchant_id}
                  {...form.getInputProps("merchant_name")}
                />
                <TextInput
                  label={t("receipts.description")}
                  {...form.getInputProps("description")}
                />

                {reviewing.line_items.length > 0 && (
                  <>
                    <Group justify="space-between">
                      <Text fw={600} size="sm">
                        {t("receipts.items")}
                      </Text>
                      <Checkbox
                        size="xs"
                        label={t("receipts.selectAll")}
                        disabled={!merchantChosen}
                        checked={reviewing.line_items.every(
                          (_, i) => priceCaptures[i]?.enabled
                        )}
                        onChange={(e) => {
                          const checked = e.currentTarget.checked;
                          const next = { ...priceCaptures };
                          reviewing.line_items.forEach((item, i) => {
                            next[i] = {
                              ...defaultCapture(item, priceCaptures[i]),
                              enabled: checked,
                            };
                          });
                          setPriceCaptures(next);
                        }}
                      />
                    </Group>
                    {!merchantChosen && (
                      <Text size="xs" c="dimmed">
                        {t("receipts.merchantForPrices")}
                      </Text>
                    )}
                    <Table withRowBorders={false} verticalSpacing={4}>
                      <Table.Tbody>
                        {reviewing.line_items.map((item, i) => {
                          const capture = defaultCapture(item, priceCaptures[i]);
                          return (
                            <Table.Tr key={i}>
                              <Table.Td>
                                <Text size="sm">{item.description}</Text>
                                <Text size="xs" c="dimmed">
                                  {item.total_price
                                    ? formatBRL(item.total_price)
                                    : ""}
                                </Text>
                              </Table.Td>
                              <Table.Td w={30}>
                                <Checkbox
                                  size="xs"
                                  checked={capture.enabled}
                                  disabled={!merchantChosen}
                                  onChange={(e) =>
                                    setPriceCaptures({
                                      ...priceCaptures,
                                      [i]: {
                                        ...capture,
                                        enabled: e.currentTarget.checked,
                                      },
                                    })
                                  }
                                  title={t("receipts.savePrice")}
                                />
                              </Table.Td>
                              <Table.Td w={170}>
                                {capture.enabled && (
                                  <Stack gap={2}>
                                    <Select
                                      size="xs"
                                      placeholder={t("receipts.product")}
                                      searchable
                                      clearable
                                      data={productOptions}
                                      value={capture.product_id}
                                      onChange={(v) =>
                                        setPriceCaptures({
                                          ...priceCaptures,
                                          [i]: { ...capture, product_id: v },
                                        })
                                      }
                                    />
                                    <TextInput
                                      size="xs"
                                      placeholder={t("receipts.orNewProduct")}
                                      disabled={!!capture.product_id}
                                      value={capture.product_name}
                                      onChange={(e) =>
                                        setPriceCaptures({
                                          ...priceCaptures,
                                          [i]: {
                                            ...capture,
                                            product_name: e.currentTarget.value,
                                          },
                                        })
                                      }
                                    />
                                  </Stack>
                                )}
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </>
                )}

                <Group justify="flex-end" mt="sm">
                  <Button
                    variant="subtle"
                    color="gray"
                    onClick={() => cancelMutation.mutate(reviewing.id)}
                  >
                    {t("receipts.cancelReceipt")}
                  </Button>
                  <Button type="submit" loading={confirmMutation.isPending}>
                    {t("receipts.confirm")}
                  </Button>
                </Group>
              </Stack>
            </form>

            <Stack gap={4} align="center">
              <Anchor href={reviewing.image} target="_blank">
                <Image src={reviewing.image} w={110} fit="contain" radius="sm" />
              </Anchor>
              <Text size="xs" c="dimmed" ta="center">
                {t("receipts.openFull")}
              </Text>
            </Stack>
          </Group>
        )}
      </Modal>
    </Stack>
  );
}
