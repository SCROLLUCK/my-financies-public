import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  FileButton,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconFileImport, IconLink } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { confirmDelete } from "../../lib/confirmDelete";
import { formatBRL, formatDate, formatDateTime } from "../../lib/format";
import { useTaxonomyLabel } from "../../i18n/taxonomy";
import type {
  Category,
  StatementImport,
  StatementTransaction,
} from "../../api/types";

interface RowState {
  checked: boolean;
  category_id: string | null;
  // Set when the user chooses to link this line to an existing expense
  // (matched by possible_duplicate) instead of importing it as a new one.
  linkExpenseId: number | null;
}

export function ImportsPage() {
  const { t } = useTranslation();
  const tx = useTaxonomyLabel();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const qc = useQueryClient();

  const { data: imports, isLoading } = useQuery({
    queryKey: ["statement-imports"],
    queryFn: () => api.get<StatementImport[]>("/statement-imports/"),
  });

  const { data: detail } = useQuery({
    queryKey: ["statement-import", selectedId],
    queryFn: () => api.get<StatementImport>(`/statement-imports/${selectedId}/`),
    enabled: !!selectedId,
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories/"),
  });

  // Category options grouped by parent category for the per-row select.
  const categoryOptions = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const c of categories ?? []) {
      const group = tx(c.topic.name);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push({ value: String(c.id), label: tx(c.name) });
    }
    return Array.from(groups.entries()).map(([group, items]) => ({
      group,
      items,
    }));
  }, [categories, tx]);

  const initRows = (statement: StatementImport) => {
    const next: Record<number, RowState> = {};
    for (const txn of statement.transactions ?? []) {
      if (txn.status !== "pending") continue;
      next[txn.id] = {
        checked: txn.direction === "out",
        category_id: txn.suggested_category
          ? String(txn.suggested_category.id)
          : null,
        linkExpenseId: null,
      };
    }
    setRows(next);
  };

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<StatementImport>("/statement-imports/", form);
    },
    onSuccess: (statement) => {
      qc.invalidateQueries({ queryKey: ["statement-imports"] });
      notifications.show({
        message: t("imports.uploaded", {
          count: statement.transactions_found,
          dups: statement.duplicates_skipped,
        }),
        color: "teal",
      });
      setSelectedId(statement.id);
      initRows(statement);
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const confirmMutation = useMutation({
    mutationFn: (
      items: { transaction_id: number; category_id?: number; link_expense_id?: number }[]
    ) =>
      api.post<{ imported: unknown[] }>(
        `/statement-imports/${selectedId}/confirm/`,
        { items }
      ),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["statement-imports"] });
      qc.invalidateQueries({ queryKey: ["statement-import", selectedId] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["incomes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["food"] });
      notifications.show({
        message: t("imports.imported", { count: result.imported.length }),
        color: "teal",
      });
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const skipMutation = useMutation({
    mutationFn: (ids: number[]) =>
      api.post<{ skipped: number }>(`/statement-imports/${selectedId}/skip/`, {
        ids,
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["statement-imports"] });
      qc.invalidateQueries({ queryKey: ["statement-import", selectedId] });
      notifications.show({
        message: t("imports.skipped", { count: result.skipped }),
        color: "teal",
      });
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del(`/statement-imports/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["statement-imports"] });
      setSelectedId(null);
    },
  });

  const pending = (detail?.transactions ?? []).filter(
    (txn) => txn.status === "pending"
  );
  const decided = (detail?.transactions ?? []).filter(
    (txn) => txn.status !== "pending"
  );

  // Credits need no category; debits need either a category or a link to an
  // existing (likely duplicate) expense.
  const readyItems = pending.filter(
    (txn) =>
      rows[txn.id]?.checked &&
      (txn.direction === "in" ||
        rows[txn.id]?.category_id ||
        rows[txn.id]?.linkExpenseId)
  );
  const checkedWithoutCategory = pending.filter(
    (txn) =>
      txn.direction === "out" &&
      rows[txn.id]?.checked &&
      !rows[txn.id]?.category_id &&
      !rows[txn.id]?.linkExpenseId
  ).length;

  const submitConfirm = () => {
    confirmMutation.mutate(
      readyItems.map((txn) =>
        txn.direction === "in"
          ? { transaction_id: txn.id }
          : rows[txn.id].linkExpenseId
            ? { transaction_id: txn.id, link_expense_id: rows[txn.id].linkExpenseId! }
            : {
                transaction_id: txn.id,
                category_id: Number(rows[txn.id].category_id),
              }
      )
    );
  };

  // One-click: import every debit that already has a category or a link
  // (suggested or hand-picked), regardless of checkboxes. Undecided lines
  // stay pending.
  const categorizedItems = pending.filter(
    (txn) =>
      txn.direction === "out" &&
      (rows[txn.id]?.category_id || rows[txn.id]?.linkExpenseId)
  );
  const submitCategorized = () => {
    confirmMutation.mutate(
      categorizedItems.map((txn) =>
        rows[txn.id].linkExpenseId
          ? { transaction_id: txn.id, link_expense_id: rows[txn.id].linkExpenseId! }
          : {
              transaction_id: txn.id,
              category_id: Number(rows[txn.id].category_id),
            }
      )
    );
  };

  const skipUnchecked = () => {
    const ids = pending
      .filter((txn) => !rows[txn.id]?.checked)
      .map((txn) => txn.id);
    if (ids.length) skipMutation.mutate(ids);
  };

  const openDetail = (statement: StatementImport) => {
    setSelectedId(statement.id);
    api
      .get<StatementImport>(`/statement-imports/${statement.id}/`)
      .then(initRows);
  };

  const directionBadge = (txn: StatementTransaction) =>
    txn.direction === "out" ? (
      <Badge variant="light" color="red">
        {t("imports.debit")}
      </Badge>
    ) : (
      <Badge variant="light" color="teal">
        {t("imports.credit")}
      </Badge>
    );

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>{t("imports.title")}</Title>
        <FileButton
          onChange={(file) => file && uploadMutation.mutate(file)}
          accept=".ofx,.csv"
        >
          {(props) => (
            <Button
              {...props}
              leftSection={<IconFileImport size={16} />}
              loading={uploadMutation.isPending}
            >
              {t("imports.upload")}
            </Button>
          )}
        </FileButton>
      </Group>

      {isLoading ? (
        <Loader />
      ) : imports && imports.length ? (
        <Group gap="sm">
          {imports.map((s) => (
            <Card
              key={s.id}
              withBorder
              padding="sm"
              radius="md"
              style={{
                cursor: "pointer",
                borderColor:
                  s.id === selectedId ? "var(--mantine-color-teal-5)" : undefined,
              }}
              onClick={() => openDetail(s)}
            >
              <Group gap="xs">
                <Badge variant="light">{s.format.toUpperCase()}</Badge>
                <Text size="sm" fw={600}>
                  {s.bank || s.original_name}
                </Text>
                {(s.pending_count ?? 0) > 0 && (
                  <Badge color="yellow" variant="light">
                    {t("imports.pendingBadge", { count: s.pending_count })}
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {formatDateTime(s.uploaded_at)} · {s.transactions_found}{" "}
                {t("imports.lines")}
              </Text>
            </Card>
          ))}
        </Group>
      ) : (
        <Text c="dimmed">{t("imports.none")}</Text>
      )}

      {detail && (
        <Card withBorder padding="lg" radius="md">
          <Group justify="space-between" mb="sm">
            <Group gap="sm">
              <Title order={4}>{detail.bank || detail.original_name}</Title>
              <Badge variant="light" color="yellow">
                {pending.length} {t("imports.pendingLabel")}
              </Badge>
            </Group>
            <Group gap="xs">
              <Button
                variant="subtle"
                color="red"
                size="compact-sm"
                onClick={() =>
                  confirmDelete(
                    t,
                    t("common.deleteItemConfirm", { name: detail.bank || detail.original_name }),
                    () => deleteMutation.mutate(detail.id)
                  )
                }
              >
                {t("imports.deleteImport")}
              </Button>
              <Button
                variant="light"
                size="compact-sm"
                onClick={skipUnchecked}
                loading={skipMutation.isPending}
              >
                {t("imports.skipUnchecked")}
              </Button>
              <Button
                variant="light"
                color="teal"
                size="compact-sm"
                onClick={submitCategorized}
                disabled={categorizedItems.length === 0}
                loading={confirmMutation.isPending}
              >
                {t("imports.confirmCategorized", {
                  count: categorizedItems.length,
                })}
              </Button>
              <Button
                size="compact-sm"
                onClick={submitConfirm}
                disabled={readyItems.length === 0}
                loading={confirmMutation.isPending}
              >
                {t("imports.confirmSelected", { count: readyItems.length })}
              </Button>
            </Group>
          </Group>

          {checkedWithoutCategory > 0 && (
            <Text size="xs" c="orange" mb="xs">
              {t("imports.missingCategories", { count: checkedWithoutCategory })}
            </Text>
          )}

          {pending.length === 0 ? (
            <Text c="dimmed">{t("imports.allDecided")}</Text>
          ) : (
            <Table.ScrollContainer minWidth={720}>
              <Table highlightOnHover verticalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={36}>
                      <Checkbox
                        size="xs"
                        checked={
                          pending.length > 0 &&
                          pending.every((txn) => rows[txn.id]?.checked)
                        }
                        onChange={(e) => {
                          const checked = e.currentTarget.checked;
                          const next = { ...rows };
                          for (const txn of pending) {
                            next[txn.id] = {
                              ...(next[txn.id] ?? {
                                category_id: null,
                                linkExpenseId: null,
                              }),
                              checked,
                            };
                          }
                          setRows(next);
                        }}
                      />
                    </Table.Th>
                    <Table.Th>{t("imports.colDate")}</Table.Th>
                    <Table.Th>{t("imports.colDescription")}</Table.Th>
                    <Table.Th />
                    <Table.Th ta="right">{t("imports.colAmount")}</Table.Th>
                    <Table.Th w={230}>{t("imports.colCategory")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pending.map((txn) => {
                    const row =
                      rows[txn.id] ??
                      { checked: false, category_id: null, linkExpenseId: null };
                    return (
                      <Table.Tr key={txn.id} opacity={row.checked ? 1 : 0.55}>
                        <Table.Td>
                          <Checkbox
                            size="xs"
                            checked={row.checked}
                            onChange={(e) =>
                              setRows({
                                ...rows,
                                [txn.id]: {
                                  ...row,
                                  checked: e.currentTarget.checked,
                                },
                              })
                            }
                          />
                        </Table.Td>
                        <Table.Td>{formatDate(txn.date)}</Table.Td>
                        <Table.Td>
                          <Text size="sm" lineClamp={1}>
                            {txn.name || txn.memo}
                          </Text>
                        </Table.Td>
                        <Table.Td>{directionBadge(txn)}</Table.Td>
                        <Table.Td ta="right">
                          {txn.direction === "in" ? (
                            <Text span c="teal" fw={600} size="sm">
                              +{formatBRL(txn.amount)}
                            </Text>
                          ) : (
                            formatBRL(txn.amount)
                          )}
                        </Table.Td>
                        <Table.Td>
                          {txn.direction === "in" ? (
                            <Text size="xs" c="dimmed">
                              {t("imports.asIncome")}
                            </Text>
                          ) : row.linkExpenseId ? (
                            <Group gap={4} wrap="nowrap">
                              <Badge
                                variant="light"
                                color="grape"
                                leftSection={<IconLink size={12} />}
                              >
                                {t("imports.linkedTo", {
                                  name: txn.possible_duplicate?.description || "",
                                })}
                              </Badge>
                              <Button
                                size="compact-xs"
                                variant="subtle"
                                onClick={() =>
                                  setRows({
                                    ...rows,
                                    [txn.id]: { ...row, linkExpenseId: null },
                                  })
                                }
                              >
                                {t("imports.undoLink")}
                              </Button>
                            </Group>
                          ) : (
                            <Stack gap={2}>
                              <Select
                                size="xs"
                                searchable
                                clearable
                                placeholder={t("imports.pickCategory")}
                                data={categoryOptions}
                                value={row.category_id}
                                onChange={(v) =>
                                  setRows({
                                    ...rows,
                                    [txn.id]: { ...row, category_id: v },
                                  })
                                }
                              />
                              {txn.possible_duplicate && (
                                <Tooltip
                                  label={`${txn.possible_duplicate.description} · ${formatBRL(txn.amount)} · ${formatDate(txn.possible_duplicate.occurred_at)}`}
                                >
                                  <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    color="orange"
                                    leftSection={<IconLink size={12} />}
                                    onClick={() =>
                                      setRows({
                                        ...rows,
                                        [txn.id]: {
                                          ...row,
                                          linkExpenseId: txn.possible_duplicate!.id,
                                        },
                                      })
                                    }
                                  >
                                    {t("imports.possibleDuplicate")}
                                  </Button>
                                </Tooltip>
                              )}
                            </Stack>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}

          {decided.length > 0 && (
            <Text size="xs" c="dimmed" mt="sm">
              {t("imports.decidedSummary", {
                imported: decided.filter((d) => d.status === "imported").length,
                skipped: decided.filter((d) => d.status === "skipped").length,
              })}
            </Text>
          )}
        </Card>
      )}
    </Stack>
  );
}
