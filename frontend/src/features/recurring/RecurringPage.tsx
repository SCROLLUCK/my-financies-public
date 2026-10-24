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
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { confirmDelete } from "../../lib/confirmDelete";
import { currentMonth, formatBRL, formatDate, toYMD } from "../../lib/format";
import { useTaxonomyLabel } from "../../i18n/taxonomy";
import { CategoryPicker } from "../../components/CategoryPicker";
import type {
  Bill,
  Category,
  IncomeSource,
  Merchant,
  RecurringExpense,
} from "../../api/types";

export function RecurringPage() {
  const { t, i18n } = useTranslation();
  const tx = useTaxonomyLabel();
  const [opened, { open, close }] = useDisclosure(false);
  const [billOpened, billModal] = useDisclosure(false);
  const [incomeListOpened, incomeListModal] = useDisclosure(false);
  const [incomeFormOpened, incomeFormModal] = useDisclosure(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [editingIncome, setEditingIncome] = useState<IncomeSource | null>(null);
  const qc = useQueryClient();
  const month = currentMonth();

  const { data: recurring, isLoading } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => api.get<RecurringExpense[]>("/recurring/"),
  });

  const { data: bills } = useQuery({
    queryKey: ["bills", month],
    queryFn: () => api.get<Bill[]>(`/bills/?month=${month}`),
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories/"),
  });

  const { data: merchants } = useQuery({
    queryKey: ["merchants"],
    queryFn: () => api.get<Merchant[]>("/merchants/"),
  });

  const { data: incomeSources } = useQuery({
    queryKey: ["income-sources"],
    queryFn: () => api.get<IncomeSource[]>("/income-sources/"),
  });

  const incomeForm = useForm({
    initialValues: {
      name: "",
      amount: "" as string | number,
      end_date: null as Date | null,
      noEndDate: true,
    },
    validate: {
      name: (v) => (v.trim() ? null : t("recurring.errIncomeSourceName")),
      amount: (v) => (Number(v) > 0 ? null : t("recurring.errIncomeSourceAmount")),
    },
  });

  const openCreateIncome = () => {
    setEditingIncome(null);
    incomeForm.reset();
    incomeFormModal.open();
  };

  const openEditIncome = (i: IncomeSource) => {
    setEditingIncome(i);
    incomeForm.setValues({
      name: i.name,
      amount: i.amount,
      end_date: i.end_date ? new Date(`${i.end_date}T00:00:00`) : null,
      noEndDate: !i.end_date,
    });
    incomeFormModal.open();
  };

  const saveIncomeMutation = useMutation({
    mutationFn: (values: typeof incomeForm.values) => {
      const payload = {
        name: values.name,
        amount: String(values.amount),
        end_date: values.noEndDate || !values.end_date ? null : toYMD(values.end_date),
      };
      return editingIncome
        ? api.patch<IncomeSource>(`/income-sources/${editingIncome.id}/`, payload)
        : api.post<IncomeSource>("/income-sources/", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income-sources"] });
      notifications.show({
        message: t(editingIncome ? "recurring.incomeSourceUpdated" : "recurring.incomeSourceAdded"),
        color: "teal",
      });
      incomeForm.reset();
      incomeFormModal.close();
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const deleteIncomeMutation = useMutation({
    mutationFn: (id: number) => api.del(`/income-sources/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income-sources"] });
      notifications.show({ message: t("recurring.incomeSourceDeleted"), color: "teal" });
    },
  });

  const form = useForm({
    initialValues: {
      name: "",
      type: "fixed",
      amount: "" as string | number,
      cadence: "monthly",
      due_day: 1 as string | number,
      topic_id: "" as string,
      category_id: "" as string,
      merchant_id: "" as string,
      active: true,
      start_date: new Date(),
      end_date: null as Date | null,
      installments: "" as string | number,
    },
    validate: {
      name: (v) => (v.trim() ? null : t("recurring.errName")),
      amount: (v) => (Number(v) > 0 ? null : t("recurring.errAmount")),
      category_id: (v) => (v ? null : t("recurring.errCategory")),
      installments: (v, values) =>
        values.type !== "installment" || Number(v) >= 2
          ? null
          : t("recurring.errInstallments"),
    },
  });

  const billForm = useForm({
    initialValues: {
      name: "",
      amount: "" as string | number,
      due_date: new Date(),
      topic_id: "" as string,
      category_id: "" as string,
    },
    validate: {
      name: (v) => (v.trim() ? null : t("bills.errName")),
      amount: (v) => (Number(v) > 0 ? null : t("bills.errAmount")),
      category_id: (v) => (v ? null : t("bills.errCategory")),
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset();
    open();
  };

  const openEdit = (r: RecurringExpense) => {
    setEditing(r);
    form.setValues({
      name: r.name,
      type: r.type,
      amount: r.amount,
      cadence: r.cadence,
      due_day: r.due_day,
      topic_id: String(r.category.topic.id),
      category_id: String(r.category.id),
      merchant_id: r.merchant ? String(r.merchant.id) : "",
      active: r.active,
      start_date: new Date(`${r.start_date}T00:00:00`),
      end_date: r.end_date ? new Date(`${r.end_date}T00:00:00`) : null,
      installments: r.installments ?? "",
    });
    open();
  };

  const toPayload = (values: typeof form.values) => ({
    name: values.name,
    type: values.type,
    amount: String(values.amount),
    cadence: values.cadence,
    due_day: Number(values.due_day),
    category_id: Number(values.category_id),
    merchant_id: values.merchant_id ? Number(values.merchant_id) : null,
    active: values.active,
    start_date: toYMD(values.start_date),
    end_date: values.end_date ? toYMD(values.end_date) : null,
    installments:
      values.type === "installment" ? Number(values.installments) : null,
  });

  const saveMutation = useMutation({
    mutationFn: (values: typeof form.values) =>
      editing
        ? api.patch<RecurringExpense>(`/recurring/${editing.id}/`, toPayload(values))
        : api.post<RecurringExpense>("/recurring/", toPayload(values)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["bills"] });
      notifications.show({
        message: t(editing ? "recurring.updated" : "recurring.added"),
        color: "teal",
      });
      form.reset();
      close();
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del(`/recurring/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      notifications.show({ message: t("recurring.deleted"), color: "teal" });
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const invalidateBills = () => {
    qc.invalidateQueries({ queryKey: ["bills"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const payMutation = useMutation({
    mutationFn: (id: number) => api.post<Bill>(`/bills/${id}/pay/`, {}),
    onSuccess: () => {
      invalidateBills();
      notifications.show({ message: t("bills.paidMsg"), color: "teal" });
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const unpayMutation = useMutation({
    mutationFn: (id: number) => api.post<Bill>(`/bills/${id}/unpay/`, {}),
    onSuccess: () => {
      invalidateBills();
      notifications.show({ message: t("bills.unpaidMsg"), color: "teal" });
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const handleUnpay = (id: number) => {
    confirmDelete(t, t("bills.unpayConfirm"), () => unpayMutation.mutate(id));
  };

  const openCreateBill = () => {
    setEditingBill(null);
    billForm.reset();
    billModal.open();
  };

  const openEditBill = (b: Bill) => {
    setEditingBill(b);
    billForm.setValues({
      name: b.name,
      amount: b.amount,
      due_date: new Date(`${b.due_date}T00:00:00`),
      topic_id: String(b.category.topic.id),
      category_id: String(b.category.id),
    });
    billModal.open();
  };

  const saveBillMutation = useMutation({
    mutationFn: (values: typeof billForm.values) => {
      const payload = {
        name: values.name,
        amount: String(values.amount),
        due_date: toYMD(values.due_date),
        category_id: Number(values.category_id),
      };
      return editingBill
        ? api.patch<Bill>(`/bills/${editingBill.id}/`, payload)
        : api.post<Bill>("/bills/", payload);
    },
    onSuccess: () => {
      invalidateBills();
      notifications.show({
        message: t(editingBill ? "bills.updated" : "bills.added"),
        color: "teal",
      });
      billForm.reset();
      billModal.close();
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const deleteBillMutation = useMutation({
    mutationFn: (id: number) => api.del(`/bills/${id}/`),
    onSuccess: () => {
      invalidateBills();
      notifications.show({ message: t("bills.deleted"), color: "teal" });
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  // Latest bill of the month per recurring entry.
  const billByRecurring = new Map<number, Bill>();
  for (const bill of bills ?? []) {
    if (bill.recurring !== null && !billByRecurring.has(bill.recurring)) {
      billByRecurring.set(bill.recurring, bill);
    }
  }
  const oneOffBills = (bills ?? []).filter((b) => b.recurring === null);

  // Monthly equivalent of active entries (yearly amounts spread across 12 months).
  const monthlyTotal = (recurring ?? [])
    .filter((r) => r.active)
    .reduce(
      (sum, r) =>
        sum + (r.cadence === "yearly" ? Number(r.amount) / 12 : Number(r.amount)),
      0
    );

  const salary = (incomeSources ?? [])
    .filter((i) => i.is_active)
    .reduce((sum, i) => sum + Number(i.amount), 0);
  const remaining = salary - monthlyTotal;

  const monthLabel = new Date().toLocaleDateString(
    i18n.language.startsWith("pt") ? "pt-BR" : "en-US",
    { month: "long", year: "numeric" }
  );

  const billBadge = (bill: Bill | undefined) =>
    !bill ? (
      <Text c="dimmed">—</Text>
    ) : bill.status === "paid" ? (
      <Badge color="teal" variant="light">
        {t("bills.paid")}
      </Badge>
    ) : bill.is_overdue ? (
      <Badge color="red" variant="light">
        {t("common.overdue")}
      </Badge>
    ) : (
      <Badge color="gray" variant="light">
        {t("bills.pending")}
      </Badge>
    );

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>{t("recurring.title")}</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          {t("recurring.add")}
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Card
          withBorder
          padding="lg"
          radius="md"
          style={{ cursor: "pointer" }}
          onClick={incomeListModal.open}
        >
          <Text c="dimmed" size="sm">
            {t("recurring.income")}
          </Text>
          <Text fw={700} size="2rem">
            {formatBRL(salary)}
          </Text>
        </Card>

        <Card withBorder padding="lg" radius="md">
          <Text c="dimmed" size="sm">
            {t("recurring.monthlyTotal")}
          </Text>
          <Text fw={700} size="2rem">
            {formatBRL(monthlyTotal)}
          </Text>
        </Card>

        <Card withBorder padding="lg" radius="md">
          <Text c="dimmed" size="sm">
            {t("recurring.remaining")}
          </Text>
          <Text fw={700} size="2rem" c={remaining < 0 ? "red" : "teal"}>
            {formatBRL(remaining)}
          </Text>
        </Card>
      </SimpleGrid>

      {isLoading ? (
        <Loader />
      ) : recurring && recurring.length ? (
        <>
        <div className="grid grid-cols-1 gap-2 md:hidden">
          {recurring.map((r) => {
            const bill = billByRecurring.get(r.id);
            return (
              <Paper key={r.id} withBorder radius="md" p="sm" opacity={r.active ? 1 : 0.5}>
                <div className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-1">
                  <Group gap={4}>
                    <Text size="sm" fw={600}>{r.name}</Text>
                    {!r.active && (
                      <Badge color="gray" variant="light">
                        {t("recurring.inactive")}
                      </Badge>
                    )}
                  </Group>
                  <Text size="sm" fw={600}>{formatBRL(r.amount)}</Text>
                  <Text size="xs" c="dimmed" className="col-span-2">
                    {t(`recurring.${r.type}`)}
                    {r.type === "installment" && r.installments ? ` (${r.installments}x)` : ""}
                    {" · "}
                    {tx(r.category.name)}
                    {" · "}
                    {t("recurring.dueDay")} {r.due_day}
                  </Text>
                  <div className="col-span-2">{billBadge(bill)}</div>
                  <div className="col-span-2 flex flex-wrap items-center justify-end gap-2">
                    {bill && bill.status === "pending" && (
                      <Button
                        size="compact-sm"
                        variant="light"
                        onClick={() => payMutation.mutate(bill.id)}
                        loading={payMutation.isPending && payMutation.variables === bill.id}
                      >
                        {t("bills.pay")}
                      </Button>
                    )}
                    {bill && bill.status === "paid" && (
                      <Button
                        size="compact-sm"
                        variant="light"
                        color="gray"
                        onClick={() => handleUnpay(bill.id)}
                        loading={unpayMutation.isPending && unpayMutation.variables === bill.id}
                      >
                        {t("bills.unpay")}
                      </Button>
                    )}
                    <ActionIcon variant="subtle" onClick={() => openEdit(r)}>
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() =>
                        confirmDelete(t, t("common.deleteItemConfirm", { name: r.name }), () =>
                          deleteMutation.mutate(r.id)
                        )
                      }
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </div>
                </div>
              </Paper>
            );
          })}
        </div>
        <Table highlightOnHover className="hidden md:table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("recurring.name")}</Table.Th>
              <Table.Th>{t("recurring.type")}</Table.Th>
              <Table.Th>{t("recurring.dueDay")}</Table.Th>
              <Table.Th>{t("recurring.category")}</Table.Th>
              <Table.Th ta="right">{t("recurring.amount")}</Table.Th>
              <Table.Th>{t("recurring.thisMonth", { month: monthLabel })}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {recurring.map((r) => {
              const bill = billByRecurring.get(r.id);
              return (
                <Table.Tr key={r.id} opacity={r.active ? 1 : 0.5}>
                  <Table.Td>
                    <Group gap="xs">
                      {r.name}
                      {!r.active && (
                        <Badge color="gray" variant="light">
                          {t("recurring.inactive")}
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {t(`recurring.${r.type}`)}
                    {r.type === "installment" && r.installments
                      ? ` (${r.installments}x)`
                      : ""}
                  </Table.Td>
                  <Table.Td>{r.due_day}</Table.Td>
                  <Table.Td>{tx(r.category.name)}</Table.Td>
                  <Table.Td ta="right">{formatBRL(r.amount)}</Table.Td>
                  <Table.Td>{billBadge(bill)}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      {bill && bill.status === "pending" && (
                        <Button
                          size="compact-sm"
                          variant="light"
                          onClick={() => payMutation.mutate(bill.id)}
                          loading={
                            payMutation.isPending &&
                            payMutation.variables === bill.id
                          }
                        >
                          {t("bills.pay")}
                        </Button>
                      )}
                      {bill && bill.status === "paid" && (
                        <Button
                          size="compact-sm"
                          variant="light"
                          color="gray"
                          onClick={() => handleUnpay(bill.id)}
                          loading={
                            unpayMutation.isPending &&
                            unpayMutation.variables === bill.id
                          }
                        >
                          {t("bills.unpay")}
                        </Button>
                      )}
                      <ActionIcon variant="subtle" onClick={() => openEdit(r)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() =>
                          confirmDelete(t, t("common.deleteItemConfirm", { name: r.name }), () =>
                            deleteMutation.mutate(r.id)
                          )
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        </>
      ) : (
        <Text c="dimmed">{t("recurring.none")}</Text>
      )}

      <Card withBorder padding="lg" radius="md">
        <Group justify="space-between" mb="md">
          <Title order={4}>{t("bills.oneOffTitle")}</Title>
          <Button
            size="compact-sm"
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={openCreateBill}
          >
            {t("bills.add")}
          </Button>
        </Group>
        {oneOffBills.length ? (
          <>
          <div className="grid grid-cols-1 gap-2 md:hidden">
            {oneOffBills.map((b) => (
              <Paper key={b.id} withBorder radius="md" p="sm">
                <div className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-1">
                  <Text size="sm" fw={600}>{b.name}</Text>
                  <Text size="sm" fw={600}>{formatBRL(b.amount)}</Text>
                  <Text size="xs" c="dimmed" className="col-span-2">
                    {tx(b.category.name)} · {formatDate(b.due_date)}
                  </Text>
                  <div className="col-span-2">{billBadge(b)}</div>
                  <div className="col-span-2 flex flex-wrap items-center justify-end gap-2">
                    {b.status === "pending" && (
                      <>
                        <Button
                          size="compact-sm"
                          variant="light"
                          onClick={() => payMutation.mutate(b.id)}
                        >
                          {t("bills.pay")}
                        </Button>
                        <ActionIcon variant="subtle" onClick={() => openEditBill(b)}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() =>
                            confirmDelete(t, t("common.deleteItemConfirm", { name: b.name }), () =>
                              deleteBillMutation.mutate(b.id)
                            )
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </>
                    )}
                    {b.status === "paid" && (
                      <Button
                        size="compact-sm"
                        variant="light"
                        color="gray"
                        onClick={() => handleUnpay(b.id)}
                        loading={unpayMutation.isPending && unpayMutation.variables === b.id}
                      >
                        {t("bills.unpay")}
                      </Button>
                    )}
                  </div>
                </div>
              </Paper>
            ))}
          </div>
          <Table highlightOnHover className="hidden md:table">
            <Table.Tbody>
              {oneOffBills.map((b) => (
                <Table.Tr key={b.id}>
                  <Table.Td>{b.name}</Table.Td>
                  <Table.Td>{tx(b.category.name)}</Table.Td>
                  <Table.Td>{formatDate(b.due_date)}</Table.Td>
                  <Table.Td ta="right">{formatBRL(b.amount)}</Table.Td>
                  <Table.Td>{billBadge(b)}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      {b.status === "pending" && (
                        <>
                          <Button
                            size="compact-sm"
                            variant="light"
                            onClick={() => payMutation.mutate(b.id)}
                          >
                            {t("bills.pay")}
                          </Button>
                          <ActionIcon
                            variant="subtle"
                            onClick={() => openEditBill(b)}
                          >
                            <IconPencil size={16} />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() =>
                              confirmDelete(t, t("common.deleteItemConfirm", { name: b.name }), () =>
                                deleteBillMutation.mutate(b.id)
                              )
                            }
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </>
                      )}
                      {b.status === "paid" && (
                        <Button
                          size="compact-sm"
                          variant="light"
                          color="gray"
                          onClick={() => handleUnpay(b.id)}
                          loading={
                            unpayMutation.isPending &&
                            unpayMutation.variables === b.id
                          }
                        >
                          {t("bills.unpay")}
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          </>
        ) : (
          <Text c="dimmed">{t("bills.none")}</Text>
        )}
      </Card>

      <Modal
        opened={opened}
        onClose={close}
        title={t(editing ? "recurring.edit" : "recurring.add")}
      >
        <form onSubmit={form.onSubmit((v) => saveMutation.mutate(v))}>
          <Stack>
            <TextInput
              label={t("recurring.name")}
              {...form.getInputProps("name")}
            />
            <SegmentedControl
              data={[
                { value: "fixed", label: t("recurring.fixed") },
                { value: "subscription", label: t("recurring.subscription") },
                { value: "installment", label: t("recurring.installment") },
              ]}
              {...form.getInputProps("type")}
            />
            <NumberInput
              label={t(
                form.values.type === "installment"
                  ? "recurring.installmentAmount"
                  : "recurring.amount"
              )}
              decimalScale={2}
              fixedDecimalScale
              min={0}
              {...form.getInputProps("amount")}
            />
            {form.values.type === "installment" ? (
              <NumberInput
                label={t("recurring.installments")}
                min={2}
                {...form.getInputProps("installments")}
              />
            ) : (
              <Select
                label={t("recurring.cadence")}
                data={[
                  { value: "monthly", label: t("recurring.monthly") },
                  { value: "yearly", label: t("recurring.yearly") },
                ]}
                {...form.getInputProps("cadence")}
              />
            )}
            <NumberInput
              label={t("recurring.dueDay")}
              min={1}
              max={31}
              {...form.getInputProps("due_day")}
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
              label={t("recurring.merchant")}
              searchable
              clearable
              data={(merchants ?? []).map((m) => ({
                value: String(m.id),
                label: m.name,
              }))}
              {...form.getInputProps("merchant_id")}
            />
            <DatePickerInput
              label={t("recurring.startDate")}
              valueFormat="DD/MM/YYYY"
              {...form.getInputProps("start_date")}
            />
            {form.values.type !== "installment" && (
              <DatePickerInput
                label={t("recurring.endDate")}
                valueFormat="DD/MM/YYYY"
                clearable
                {...form.getInputProps("end_date")}
              />
            )}
            <Switch
              label={t("recurring.active")}
              {...form.getInputProps("active", { type: "checkbox" })}
            />
            <Button type="submit" loading={saveMutation.isPending}>
              {t("common.save")}
            </Button>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={billOpened}
        onClose={billModal.close}
        title={t(editingBill ? "bills.edit" : "bills.add")}
      >
        <form onSubmit={billForm.onSubmit((v) => saveBillMutation.mutate(v))}>
          <Stack>
            <TextInput
              label={t("bills.name")}
              {...billForm.getInputProps("name")}
            />
            <NumberInput
              label={t("bills.amount")}
              decimalScale={2}
              fixedDecimalScale
              min={0}
              {...billForm.getInputProps("amount")}
            />
            <DatePickerInput
              label={t("bills.dueDate")}
              valueFormat="DD/MM/YYYY"
              {...billForm.getInputProps("due_date")}
            />
            <CategoryPicker
              categories={categories}
              topicId={billForm.values.topic_id}
              categoryId={billForm.values.category_id}
              onTopicChange={(v) => billForm.setFieldValue("topic_id", v)}
              onCategoryChange={(v) => billForm.setFieldValue("category_id", v)}
              error={billForm.errors.category_id}
            />
            <Button type="submit" loading={saveBillMutation.isPending}>
              {t("common.save")}
            </Button>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={incomeListOpened}
        onClose={incomeListModal.close}
        title={t("recurring.incomeSources")}
      >
        <Stack>
          <Button
            leftSection={<IconPlus size={16} />}
            variant="light"
            onClick={openCreateIncome}
          >
            {t("recurring.addIncomeSource")}
          </Button>
          {incomeSources && incomeSources.length ? (
            <Stack gap="xs">
              {incomeSources.map((i) => (
                <Paper key={i.id} withBorder radius="md" p="sm">
                  <Group justify="space-between" wrap="nowrap">
                    <div>
                      <Group gap={4}>
                        <Text size="sm" fw={600}>{i.name}</Text>
                        {!i.is_active && (
                          <Badge color="gray" variant="light">
                            {t("recurring.endedBadge")}
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed">
                        {i.end_date
                          ? `${t("recurring.incomeSourceEndDate")}: ${formatDate(i.end_date)}`
                          : t("recurring.noEndDate")}
                      </Text>
                    </div>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" fw={600}>{formatBRL(i.amount)}</Text>
                      <ActionIcon variant="subtle" onClick={() => openEditIncome(i)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() =>
                          confirmDelete(t, t("common.deleteItemConfirm", { name: i.name }), () =>
                            deleteIncomeMutation.mutate(i.id)
                          )
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Group>
                </Paper>
              ))}
            </Stack>
          ) : (
            <Text c="dimmed">{t("recurring.noIncomeSources")}</Text>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={incomeFormOpened}
        onClose={incomeFormModal.close}
        title={t(editingIncome ? "recurring.editIncomeSource" : "recurring.addIncomeSource")}
      >
        <form onSubmit={incomeForm.onSubmit((v) => saveIncomeMutation.mutate(v))}>
          <Stack>
            <TextInput
              label={t("recurring.incomeSourceName")}
              {...incomeForm.getInputProps("name")}
            />
            <NumberInput
              label={t("recurring.incomeSourceAmount")}
              decimalScale={2}
              fixedDecimalScale
              min={0}
              {...incomeForm.getInputProps("amount")}
            />
            <Switch
              label={t("recurring.noEndDate")}
              checked={incomeForm.values.noEndDate}
              onChange={(e) =>
                incomeForm.setFieldValue("noEndDate", e.currentTarget.checked)
              }
            />
            {!incomeForm.values.noEndDate && (
              <DatePickerInput
                label={t("recurring.incomeSourceEndDate")}
                valueFormat="DD/MM/YYYY"
                {...incomeForm.getInputProps("end_date")}
              />
            )}
            <Button type="submit" loading={saveIncomeMutation.isPending}>
              {t("common.save")}
            </Button>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
