import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
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
import {
  DatePickerInput,
  DateTimePicker,
  MonthPickerInput,
  YearPickerInput,
} from "@mantine/dates";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { confirmDelete } from "../../lib/confirmDelete";
import {
  currentMonth,
  formatBRL,
  formatDate,
  formatDateTime,
  toYMD,
} from "../../lib/format";
import { useTaxonomyLabel } from "../../i18n/taxonomy";
import { CategoryPicker } from "../../components/CategoryPicker";
import type {
  Category,
  Expense,
  Income,
  Merchant,
  ProjectedExpense,
} from "../../api/types";

function monthToDate(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export function ExpensesPage() {
  const { t } = useTranslation();
  const tx = useTaxonomyLabel();
  const [periodMode, setPeriodMode] = useState<string>("month");
  const [month, setMonth] = useState<string>(currentMonth());
  const [year, setYear] = useState<Date>(new Date());
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null]);
  const [kind, setKind] = useState<string>("all");
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [spentByFilter, setSpentByFilter] = useState<string | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const qc = useQueryClient();

  const periodParams =
    periodMode === "month"
      ? `month=${month}`
      : periodMode === "year"
        ? `year=${year.getFullYear()}`
        : range[0] && range[1]
          ? `date_from=${toYMD(range[0])}&date_to=${toYMD(range[1])}`
          : "";

  const { data: expenses, isLoading } = useQuery({
    queryKey: ["expenses", periodParams, kind, topicFilter, categoryFilter, spentByFilter],
    queryFn: () =>
      api.get<Expense[]>(
        `/expenses/?${periodParams}` +
          (kind !== "all" ? `&kind=${kind}` : "") +
          (topicFilter ? `&topic=${topicFilter}` : "") +
          (categoryFilter ? `&category=${categoryFilter}` : "") +
          (spentByFilter ? `&spent_by=${spentByFilter}` : "")
      ),
    enabled: periodMode !== "range" || (!!range[0] && !!range[1]),
  });

  // Incomes are shown interleaved only in the unfiltered view (they have no
  // category/kind to filter by).
  const showIncomes = kind === "all" && !topicFilter && !categoryFilter && !spentByFilter;
  const { data: incomes } = useQuery({
    queryKey: ["incomes", periodParams],
    queryFn: () => api.get<Income[]>(`/incomes/?${periodParams}`),
    enabled: showIncomes && (periodMode !== "range" || (!!range[0] && !!range[1])),
  });
  const incomeRows = showIncomes ? (incomes ?? []) : [];
  const incomesTotal = incomeRows.reduce((sum, i) => sum + Number(i.amount), 0);

  const deleteIncomeMutation = useMutation({
    mutationFn: (id: number) => api.del(`/incomes/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incomes"] });
      notifications.show({ message: t("expenses.incomeDeleted"), color: "teal" });
    },
  });

  // Future months: show what recurring/installments are expected to charge.
  const isFutureMonth = periodMode === "month" && month > currentMonth();
  const { data: projected } = useQuery({
    queryKey: ["projected", month],
    queryFn: () => api.get<ProjectedExpense[]>(`/bills/projected/?month=${month}`),
    enabled: isFutureMonth,
  });
  const projectedRows = isFutureMonth ? (projected ?? []) : [];
  const projectedTotal = projectedRows.reduce(
    (sum, p) => sum + Number(p.amount),
    0
  );

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories/"),
  });

  const { data: merchants } = useQuery({
    queryKey: ["merchants"],
    queryFn: () => api.get<Merchant[]>("/merchants/"),
  });

  const form = useForm({
    initialValues: {
      amount: "" as string | number,
      occurred_at: new Date(),
      topic_id: "" as string,
      category_id: "" as string,
      kind: "one_off",
      merchant_id: "" as string,
      description: "",
      spent_by: "" as string,
    },
    validate: {
      amount: (v) => (Number(v) > 0 ? null : t("expenses.errAmount")),
      category_id: (v) => (v ? null : t("expenses.errCategory")),
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset();
    open();
  };

  const openEdit = (e: Expense) => {
    setEditing(e);
    form.setValues({
      amount: e.amount,
      occurred_at: new Date(e.occurred_at),
      topic_id: String(e.category.topic.id),
      category_id: String(e.category.id),
      kind: e.kind,
      merchant_id: e.merchant ? String(e.merchant.id) : "",
      description: e.description,
      spent_by: e.spent_by,
    });
    open();
  };

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["food"] });
  };

  const saveMutation = useMutation({
    mutationFn: (values: typeof form.values) => {
      const payload = {
        amount: String(values.amount),
        occurred_at: values.occurred_at.toISOString(),
        category_id: Number(values.category_id),
        kind: values.kind,
        merchant_id: values.merchant_id ? Number(values.merchant_id) : null,
        description: values.description,
        spent_by: values.spent_by,
      };
      return editing
        ? api.patch<Expense>(`/expenses/${editing.id}/`, payload)
        : api.post<Expense>("/expenses/", payload);
    },
    onSuccess: () => {
      invalidateAll();
      notifications.show({
        message: t(editing ? "expenses.updated" : "expenses.added"),
        color: "teal",
      });
      form.reset();
      close();
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del(`/expenses/${id}/`),
    onSuccess: () => {
      invalidateAll();
      notifications.show({ message: t("expenses.deleted"), color: "teal" });
    },
  });

  const monthTotal = (expenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0);

  // Expenses and incomes interleaved, newest first.
  const ledgerRows = [
    ...(expenses ?? []).map((e) => ({ kind: "expense" as const, at: e.occurred_at, expense: e })),
    ...incomeRows.map((i) => ({ kind: "income" as const, at: i.occurred_at, income: i })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const topics = Array.from(
    new Map((categories ?? []).map((c) => [c.topic.id, c.topic])).values()
  ).sort((a, b) => a.order - b.order);
  const topicExpenseCount = (topicId: number) =>
    (categories ?? [])
      .filter((c) => c.topic.id === topicId)
      .reduce((sum, c) => sum + c.expense_count, 0);
  const topicFilterOptions = topics.map((tp) => ({
    value: String(tp.id),
    label: `${tx(tp.name)} (${topicExpenseCount(tp.id)})`,
  }));
  const categoryFilterOptions = (categories ?? [])
    .filter((c) => String(c.topic.id) === topicFilter)
    .map((c) => ({
      value: String(c.id),
      label: `${tx(c.name)} (${c.expense_count})`,
    }));

  return (
    <Stack gap="lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Title order={2}>{t("expenses.title")}</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          {t("expenses.add")}
        </Button>
      </div>

      <Group gap="xs">
        <Badge size="lg" variant="light" color="teal">
          {t("expenses.monthTotal")}: {formatBRL(monthTotal)}
        </Badge>
        {incomeRows.length > 0 && (
          <Badge size="lg" variant="light" color="green">
            {t("expenses.incomesTotal")}: +{formatBRL(incomesTotal)}
          </Badge>
        )}
        {projectedRows.length > 0 && (
          <Badge size="lg" variant="light" color="yellow">
            {t("expenses.projectedTotal")}: {formatBRL(projectedTotal)}
          </Badge>
        )}
      </Group>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:flex lg:flex-wrap lg:items-center">
        <Select
          placeholder={t("common.topic")}
          searchable
          clearable
          data={topicFilterOptions}
          value={topicFilter}
          onChange={(v) => {
            setTopicFilter(v);
            setCategoryFilter(null);
          }}
          className="lg:w-40"
        />
        <Select
          placeholder={t("common.category")}
          searchable
          clearable
          disabled={!topicFilter}
          data={categoryFilterOptions}
          value={categoryFilter}
          onChange={setCategoryFilter}
          className="lg:w-40"
        />
        <Select
          value={kind}
          onChange={(v) => setKind(v ?? "all")}
          data={[
            { value: "all", label: t("expenses.kindAll") },
            { value: "fixed", label: t("expenses.kind_fixed") },
            { value: "subscription", label: t("expenses.kind_subscription") },
            { value: "installment", label: t("expenses.kind_installment") },
            { value: "one_off", label: t("expenses.kind_one_off") },
          ]}
          className="lg:w-40"
        />
        <Select
          placeholder={t("expenses.spentBy")}
          clearable
          data={[
            { value: "owner", label: "Me" },
            { value: "partner", label: "Partner" },
          ]}
          value={spentByFilter}
          onChange={setSpentByFilter}
          className="lg:w-36"
        />
        <Select
          value={periodMode}
          onChange={(v) => setPeriodMode(v ?? "month")}
          data={[
            { value: "month", label: t("expenses.periodMonth") },
            { value: "year", label: t("expenses.periodYear") },
            { value: "range", label: t("expenses.periodRange") },
          ]}
          className="lg:w-28"
        />
        {periodMode === "month" && (
          <MonthPickerInput
            value={monthToDate(month)}
            onChange={(d) =>
              d &&
              setMonth(
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
              )
            }
            className="col-span-2 sm:col-span-1 lg:w-44"
          />
        )}
        {periodMode === "year" && (
          <YearPickerInput
            value={year}
            onChange={(d) => d && setYear(d)}
            className="col-span-2 sm:col-span-1 lg:w-32"
          />
        )}
        {periodMode === "range" && (
          <DatePickerInput
            type="range"
            value={range}
            onChange={setRange}
            valueFormat="DD/MM/YYYY"
            className="col-span-2 lg:w-64"
          />
        )}
      </div>

      {isLoading && !isFutureMonth ? (
        <Loader />
      ) : ledgerRows.length || projectedRows.length ? (
        <>
        <div className="grid grid-cols-1 gap-2 md:hidden">
          {projectedRows.map((p, i) => (
            <Paper key={`p-${i}`} withBorder radius="md" p="sm" opacity={0.6}>
              <div className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-1">
                <Text size="xs" c="dimmed">{formatDate(p.due_date)}</Text>
                <Text size="sm" fw={600}>{formatBRL(p.amount)}</Text>
                <Text size="sm" className="col-span-2">{p.name}</Text>
                <Text size="xs" c="dimmed" className="col-span-2">
                  {tx(p.category.topic.name)} / {tx(p.category.name)}
                </Text>
                <Group gap={4} className="col-span-2">
                  <Badge
                    variant="light"
                    color={
                      p.kind === "fixed"
                        ? "blue"
                        : p.kind === "subscription"
                          ? "grape"
                          : p.kind === "installment"
                            ? "orange"
                            : "gray"
                    }
                  >
                    {t(`expenses.kind_${p.kind}`)}
                  </Badge>
                  <Badge variant="outline" color="yellow">
                    {t("expenses.projected")}
                  </Badge>
                </Group>
              </div>
            </Paper>
          ))}
          {ledgerRows.map((row) =>
            row.kind === "income" ? (
              <Paper key={`i-${row.income.id}`} withBorder radius="md" p="sm">
                <div className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-1">
                  <Text size="xs" c="dimmed">{formatDateTime(row.income.occurred_at)}</Text>
                  <Text size="sm" fw={600} c="teal">
                    +{formatBRL(row.income.amount)}
                  </Text>
                  <Text size="sm" className="col-span-2">{row.income.description}</Text>
                  <div className="col-span-2 flex items-center justify-between">
                    <Badge variant="light" color="green">
                      {t("expenses.income")}
                    </Badge>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() =>
                        confirmDelete(
                          t,
                          t("common.deleteItemConfirm", {
                            name: row.income.description || formatBRL(row.income.amount),
                          }),
                          () => deleteIncomeMutation.mutate(row.income.id)
                        )
                      }
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </div>
                </div>
              </Paper>
            ) : (
              <Paper key={row.expense.id} withBorder radius="md" p="sm">
                <div className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-1">
                  <Text size="xs" c="dimmed">{formatDateTime(row.expense.occurred_at)}</Text>
                  <Text size="sm" fw={600}>{formatBRL(row.expense.amount)}</Text>
                  <Text size="sm" className="col-span-2">{row.expense.description || "—"}</Text>
                  <Text size="xs" c="dimmed" className="col-span-2">
                    {tx(row.expense.category.topic.name)} / {tx(row.expense.category.name)}
                  </Text>
                  <div className="col-span-2 flex items-center justify-between">
                    <Group gap={4}>
                      <Badge
                        variant="light"
                        color={
                          row.expense.kind === "fixed"
                            ? "blue"
                            : row.expense.kind === "subscription"
                              ? "grape"
                              : row.expense.kind === "installment"
                                ? "orange"
                                : "gray"
                        }
                      >
                        {t(`expenses.kind_${row.expense.kind}`)}
                      </Badge>
                      {row.expense.spent_by && (
                        <Badge
                          variant="dot"
                          color={row.expense.spent_by === "owner" ? "blue" : "pink"}
                        >
                          {row.expense.spent_by === "owner" ? "Me" : "Partner"}
                        </Badge>
                      )}
                    </Group>
                    <Group gap={4}>
                      <ActionIcon variant="subtle" onClick={() => openEdit(row.expense)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() =>
                          confirmDelete(
                            t,
                            t("common.deleteItemConfirm", {
                              name: row.expense.description || formatBRL(row.expense.amount),
                            }),
                            () => deleteMutation.mutate(row.expense.id)
                          )
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </div>
                </div>
              </Paper>
            )
          )}
        </div>
        <Table highlightOnHover className="hidden md:table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("expenses.colDate")}</Table.Th>
              <Table.Th>{t("expenses.colCategory")}</Table.Th>
              <Table.Th>{t("expenses.colKind")}</Table.Th>
              <Table.Th>{t("expenses.colSpentBy")}</Table.Th>
              <Table.Th>{t("expenses.colDescription")}</Table.Th>
              <Table.Th ta="right">{t("expenses.colAmount")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {projectedRows.map((p, i) => (
              <Table.Tr key={`p-${i}`} opacity={0.6}>
                <Table.Td>{formatDate(p.due_date)}</Table.Td>
                <Table.Td>
                  {tx(p.category.topic.name)} / {tx(p.category.name)}
                </Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Badge
                      variant="light"
                      color={
                        p.kind === "fixed"
                          ? "blue"
                          : p.kind === "subscription"
                            ? "grape"
                            : p.kind === "installment"
                              ? "orange"
                              : "gray"
                      }
                    >
                      {t(`expenses.kind_${p.kind}`)}
                    </Badge>
                    <Badge variant="outline" color="yellow">
                      {t("expenses.projected")}
                    </Badge>
                  </Group>
                </Table.Td>
                <Table.Td />
                <Table.Td>{p.name}</Table.Td>
                <Table.Td ta="right">{formatBRL(p.amount)}</Table.Td>
                <Table.Td />
              </Table.Tr>
            ))}
            {ledgerRows.map((row) =>
              row.kind === "income" ? (
                <Table.Tr key={`i-${row.income.id}`}>
                  <Table.Td>{formatDateTime(row.income.occurred_at)}</Table.Td>
                  <Table.Td>
                    <Text c="dimmed">—</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color="green">
                      {t("expenses.income")}
                    </Badge>
                  </Table.Td>
                  <Table.Td />
                  <Table.Td>{row.income.description}</Table.Td>
                  <Table.Td ta="right">
                    <Text span c="teal" fw={600}>
                      +{formatBRL(row.income.amount)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() =>
                          confirmDelete(
                            t,
                            t("common.deleteItemConfirm", {
                              name: row.income.description || formatBRL(row.income.amount),
                            }),
                            () => deleteIncomeMutation.mutate(row.income.id)
                          )
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ) : (
                <Table.Tr key={row.expense.id}>
                  <Table.Td>{formatDateTime(row.expense.occurred_at)}</Table.Td>
                  <Table.Td>
                    {tx(row.expense.category.topic.name)} /{" "}
                    {tx(row.expense.category.name)}
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      variant="light"
                      color={
                        row.expense.kind === "fixed"
                          ? "blue"
                          : row.expense.kind === "subscription"
                            ? "grape"
                            : row.expense.kind === "installment"
                              ? "orange"
                              : "gray"
                      }
                    >
                      {t(`expenses.kind_${row.expense.kind}`)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {row.expense.spent_by ? (
                      <Badge
                        variant="dot"
                        color={row.expense.spent_by === "owner" ? "blue" : "pink"}
                      >
                        {row.expense.spent_by === "owner" ? "Me" : "Partner"}
                      </Badge>
                    ) : (
                      <Text c="dimmed">—</Text>
                    )}
                  </Table.Td>
                  <Table.Td>{row.expense.description}</Table.Td>
                  <Table.Td ta="right">{formatBRL(row.expense.amount)}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        onClick={() => openEdit(row.expense)}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() =>
                          confirmDelete(
                            t,
                            t("common.deleteItemConfirm", {
                              name: row.expense.description || formatBRL(row.expense.amount),
                            }),
                            () => deleteMutation.mutate(row.expense.id)
                          )
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              )
            )}
          </Table.Tbody>
        </Table>
        </>
      ) : (
        <Text c="dimmed">{t("expenses.none")}</Text>
      )}

      <Modal
        opened={opened}
        onClose={close}
        title={t(editing ? "expenses.edit" : "expenses.add")}
      >
        <form onSubmit={form.onSubmit((v) => saveMutation.mutate(v))}>
          <Stack>
            <NumberInput
              label={t("expenses.amount")}
              decimalScale={2}
              fixedDecimalScale
              min={0}
              {...form.getInputProps("amount")}
            />
            <DateTimePicker
              label={t("expenses.date")}
              valueFormat="DD/MM/YYYY HH:mm"
              {...form.getInputProps("occurred_at")}
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
              label={t("expenses.colKind")}
              data={[
                { value: "one_off", label: t("expenses.kind_one_off") },
                { value: "fixed", label: t("expenses.kind_fixed") },
                { value: "subscription", label: t("expenses.kind_subscription") },
                { value: "installment", label: t("expenses.kind_installment") },
              ]}
              {...form.getInputProps("kind")}
            />
            <Select
              label={t("expenses.merchant")}
              searchable
              clearable
              data={(merchants ?? []).map((m) => ({
                value: String(m.id),
                label: m.name,
              }))}
              {...form.getInputProps("merchant_id")}
            />
            <TextInput
              label={t("expenses.description")}
              {...form.getInputProps("description")}
            />
            <Select
              label={t("expenses.spentBy")}
              clearable
              data={[
                { value: "owner", label: "Me" },
                { value: "partner", label: "Partner" },
              ]}
              {...form.getInputProps("spent_by")}
            />
            <Button type="submit" loading={saveMutation.isPending}>
              {t("common.save")}
            </Button>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
