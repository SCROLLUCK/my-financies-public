import { useState } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconPlus, IconShoppingBag, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { confirmDelete } from "../../lib/confirmDelete";
import { formatBRL, formatDate, toYMD } from "../../lib/format";
import { useTaxonomyLabel } from "../../i18n/taxonomy";
import { CategoryPicker } from "../../components/CategoryPicker";
import type { Category, PlannedPurchase } from "../../api/types";

const PRIORITY_COLORS = { low: "gray", medium: "yellow", high: "red" } as const;

export function PlannedPage() {
  const { t } = useTranslation();
  const tx = useTaxonomyLabel();
  const [status, setStatus] = useState<string>("planned");
  const [priority, setPriority] = useState<string>("all");
  const [editing, setEditing] = useState<PlannedPurchase | null>(null);
  const [purchasing, setPurchasing] = useState<PlannedPurchase | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const qc = useQueryClient();

  const { data: items, isLoading } = useQuery({
    queryKey: ["planned", status, priority],
    queryFn: () =>
      api.get<PlannedPurchase[]>(
        `/planned-purchases/?status=${status}${
          priority !== "all" ? `&priority=${priority}` : ""
        }`
      ),
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories/"),
  });

  const form = useForm({
    initialValues: {
      name: "",
      estimated_cost: "" as string | number,
      priority: "medium",
      topic_id: "" as string,
      category_id: "" as string,
      target_date: null as Date | null,
      url: "",
      notes: "",
    },
    validate: {
      name: (v) => (v.trim() ? null : t("planned.errName")),
    },
  });

  const purchaseForm = useForm({
    initialValues: {
      amount: "" as string | number,
      topic_id: "" as string,
      category_id: "" as string,
    },
    validate: {
      amount: (v) => (Number(v) > 0 ? null : t("planned.errAmount")),
      category_id: (v, _values) =>
        purchasing?.category || v ? null : t("planned.errCategory"),
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["planned"] });

  const toPayload = (values: typeof form.values) => ({
    name: values.name,
    estimated_cost:
      values.estimated_cost === "" ? null : String(values.estimated_cost),
    priority: values.priority,
    category_id: values.category_id ? Number(values.category_id) : null,
    target_date: values.target_date ? toYMD(values.target_date) : null,
    url: values.url,
    notes: values.notes,
  });

  const saveMutation = useMutation({
    mutationFn: (values: typeof form.values) =>
      editing
        ? api.patch<PlannedPurchase>(
            `/planned-purchases/${editing.id}/`,
            toPayload(values)
          )
        : api.post<PlannedPurchase>("/planned-purchases/", toPayload(values)),
    onSuccess: () => {
      invalidate();
      notifications.show({
        message: t(editing ? "planned.updated" : "planned.added"),
        color: "teal",
      });
      form.reset();
      close();
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const purchaseMutation = useMutation({
    mutationFn: (values: typeof purchaseForm.values) =>
      api.post<PlannedPurchase>(`/planned-purchases/${purchasing!.id}/purchase/`, {
        amount: String(values.amount),
        ...(values.category_id ? { category_id: Number(values.category_id) } : {}),
      }),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      notifications.show({ message: t("planned.purchasedMsg"), color: "teal" });
      purchaseForm.reset();
      setPurchasing(null);
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status: newStatus }: { id: number; status: string }) =>
      api.patch<PlannedPurchase>(`/planned-purchases/${id}/`, { status: newStatus }),
    onSuccess: invalidate,
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del(`/planned-purchases/${id}/`),
    onSuccess: () => {
      invalidate();
      notifications.show({ message: t("planned.deleted"), color: "teal" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset();
    open();
  };

  const openEdit = (p: PlannedPurchase) => {
    setEditing(p);
    form.setValues({
      name: p.name,
      estimated_cost: p.estimated_cost ?? "",
      priority: p.priority,
      topic_id: p.category ? String(p.category.topic.id) : "",
      category_id: p.category ? String(p.category.id) : "",
      target_date: p.target_date ? new Date(`${p.target_date}T00:00:00`) : null,
      url: p.url,
      notes: p.notes,
    });
    open();
  };

  const openPurchase = (p: PlannedPurchase) => {
    setPurchasing(p);
    purchaseForm.setValues({
      amount: p.estimated_cost ?? "",
      topic_id: "",
      category_id: "",
    });
  };

  const openItems = (items ?? []).filter((p) => p.status === "planned");
  const openTotal = openItems.reduce(
    (sum, p) => sum + Number(p.estimated_cost ?? 0),
    0
  );
  const withoutEstimate = openItems.filter((p) => !p.estimated_cost).length;

  return (
    <Stack gap="lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Title order={2}>{t("planned.title")}</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          {t("planned.add")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Select
          value={status}
          onChange={(v) => setStatus(v ?? "planned")}
          data={[
            { value: "planned", label: t("planned.statusPlanned") },
            { value: "purchased", label: t("planned.statusPurchased") },
            { value: "dropped", label: t("planned.statusDropped") },
          ]}
          className="sm:w-40"
        />
        <Select
          value={priority}
          onChange={(v) => setPriority(v ?? "all")}
          data={[
            { value: "all", label: t("planned.priorityAll") },
            { value: "high", label: t("planned.high") },
            { value: "medium", label: t("planned.medium") },
            { value: "low", label: t("planned.low") },
          ]}
          className="sm:w-40"
        />
      </div>

      {status === "planned" && (
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Card withBorder padding="lg" radius="md">
            <Text c="dimmed" size="sm">
              {t("planned.openTotal")}
            </Text>
            <Text fw={700} size="2rem">
              {formatBRL(openTotal)}
            </Text>
            {withoutEstimate > 0 && (
              <Text c="dimmed" size="xs" mt="xs">
                {t("planned.withoutEstimate", { count: withoutEstimate })}
              </Text>
            )}
          </Card>
        </SimpleGrid>
      )}

      {isLoading ? (
        <Loader />
      ) : items && items.length ? (
        <>
        <div className="grid grid-cols-1 gap-2 md:hidden">
          {items.map((p) => (
            <Paper key={p.id} withBorder radius="md" p="sm">
              <div className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-1">
                <div>
                  <Text size="sm" fw={600}>
                    {p.url ? (
                      <Anchor href={p.url} target="_blank" rel="noreferrer">
                        {p.name}
                      </Anchor>
                    ) : (
                      p.name
                    )}
                  </Text>
                  {p.notes && (
                    <Text size="xs" c="dimmed">
                      {p.notes}
                    </Text>
                  )}
                </div>
                <Text size="sm" fw={600}>
                  {p.estimated_cost ? formatBRL(p.estimated_cost) : "—"}
                </Text>
                <Text size="xs" c="dimmed" className="col-span-2">
                  {p.category ? tx(p.category.name) : "—"}
                  {p.target_date ? ` · ${formatDate(p.target_date)}` : ""}
                </Text>
                <Group gap={4} className="col-span-2">
                  <Badge variant="light" color={PRIORITY_COLORS[p.priority]}>
                    {t(`planned.${p.priority}`)}
                  </Badge>
                </Group>
                <div className="col-span-2 flex flex-wrap items-center justify-end gap-2">
                  {p.status === "planned" && (
                    <>
                      <Button
                        size="compact-sm"
                        variant="light"
                        leftSection={<IconShoppingBag size={14} />}
                        onClick={() => openPurchase(p)}
                      >
                        {t("planned.purchase")}
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color="gray"
                        onClick={() =>
                          statusMutation.mutate({ id: p.id, status: "dropped" })
                        }
                      >
                        {t("planned.drop")}
                      </Button>
                    </>
                  )}
                  {p.status === "dropped" && (
                    <Button
                      size="compact-sm"
                      variant="light"
                      onClick={() =>
                        statusMutation.mutate({ id: p.id, status: "planned" })
                      }
                    >
                      {t("planned.restore")}
                    </Button>
                  )}
                  {p.status !== "purchased" && (
                    <>
                      <ActionIcon variant="subtle" onClick={() => openEdit(p)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() =>
                          confirmDelete(t, t("common.deleteItemConfirm", { name: p.name }), () =>
                            deleteMutation.mutate(p.id)
                          )
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </>
                  )}
                </div>
              </div>
            </Paper>
          ))}
        </div>
        <Table highlightOnHover className="hidden md:table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("planned.name")}</Table.Th>
              <Table.Th>{t("planned.priority")}</Table.Th>
              <Table.Th>{t("planned.category")}</Table.Th>
              <Table.Th>{t("planned.targetDate")}</Table.Th>
              <Table.Th ta="right">{t("planned.estimate")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>
                  {p.url ? (
                    <Anchor href={p.url} target="_blank" rel="noreferrer">
                      {p.name}
                    </Anchor>
                  ) : (
                    p.name
                  )}
                  {p.notes && (
                    <Text size="xs" c="dimmed">
                      {p.notes}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={PRIORITY_COLORS[p.priority]}>
                    {t(`planned.${p.priority}`)}
                  </Badge>
                </Table.Td>
                <Table.Td>{p.category ? tx(p.category.name) : "—"}</Table.Td>
                <Table.Td>
                  {p.target_date ? formatDate(p.target_date) : "—"}
                </Table.Td>
                <Table.Td ta="right">
                  {p.estimated_cost ? formatBRL(p.estimated_cost) : "—"}
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    {p.status === "planned" && (
                      <>
                        <Button
                          size="compact-sm"
                          variant="light"
                          leftSection={<IconShoppingBag size={14} />}
                          onClick={() => openPurchase(p)}
                        >
                          {t("planned.purchase")}
                        </Button>
                        <Button
                          size="compact-sm"
                          variant="subtle"
                          color="gray"
                          onClick={() =>
                            statusMutation.mutate({ id: p.id, status: "dropped" })
                          }
                        >
                          {t("planned.drop")}
                        </Button>
                      </>
                    )}
                    {p.status === "dropped" && (
                      <Button
                        size="compact-sm"
                        variant="light"
                        onClick={() =>
                          statusMutation.mutate({ id: p.id, status: "planned" })
                        }
                      >
                        {t("planned.restore")}
                      </Button>
                    )}
                    {p.status !== "purchased" && (
                      <>
                        <ActionIcon variant="subtle" onClick={() => openEdit(p)}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() =>
                            confirmDelete(t, t("common.deleteItemConfirm", { name: p.name }), () =>
                              deleteMutation.mutate(p.id)
                            )
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        </>
      ) : (
        <Text c="dimmed">{t("planned.none")}</Text>
      )}

      <Modal
        opened={opened}
        onClose={close}
        title={t(editing ? "planned.edit" : "planned.add")}
      >
        <form onSubmit={form.onSubmit((v) => saveMutation.mutate(v))}>
          <Stack>
            <TextInput label={t("planned.name")} {...form.getInputProps("name")} />
            <NumberInput
              label={t("planned.estimateOptional")}
              decimalScale={2}
              fixedDecimalScale
              min={0}
              {...form.getInputProps("estimated_cost")}
            />
            <Select
              label={t("planned.priority")}
              data={[
                { value: "high", label: t("planned.high") },
                { value: "medium", label: t("planned.medium") },
                { value: "low", label: t("planned.low") },
              ]}
              {...form.getInputProps("priority")}
            />
            <CategoryPicker
              categories={categories}
              topicId={form.values.topic_id}
              categoryId={form.values.category_id}
              onTopicChange={(v) => form.setFieldValue("topic_id", v)}
              onCategoryChange={(v) => form.setFieldValue("category_id", v)}
            />
            <DatePickerInput
              label={t("planned.targetDateOptional")}
              valueFormat="DD/MM/YYYY"
              clearable
              {...form.getInputProps("target_date")}
            />
            <TextInput
              label={t("planned.url")}
              placeholder="https://…"
              {...form.getInputProps("url")}
            />
            <Textarea label={t("planned.notes")} {...form.getInputProps("notes")} />
            <Button type="submit" loading={saveMutation.isPending}>
              {t("common.save")}
            </Button>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={!!purchasing}
        onClose={() => setPurchasing(null)}
        title={
          purchasing
            ? `${t("planned.purchaseTitle")}: ${purchasing.name}`
            : ""
        }
      >
        <form onSubmit={purchaseForm.onSubmit((v) => purchaseMutation.mutate(v))}>
          <Stack>
            <NumberInput
              label={t("planned.actualAmount")}
              decimalScale={2}
              fixedDecimalScale
              min={0}
              {...purchaseForm.getInputProps("amount")}
            />
            {!purchasing?.category && (
              <CategoryPicker
                categories={categories}
                topicId={purchaseForm.values.topic_id}
                categoryId={purchaseForm.values.category_id}
                onTopicChange={(v) => purchaseForm.setFieldValue("topic_id", v)}
                onCategoryChange={(v) =>
                  purchaseForm.setFieldValue("category_id", v)
                }
                error={purchaseForm.errors.category_id}
              />
            )}
            <Button type="submit" loading={purchaseMutation.isPending}>
              {t("planned.confirmPurchase")}
            </Button>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
