import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Loader,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { DatePickerInput, MonthPickerInput } from "@mantine/dates";
import { BarChart } from "@mantine/charts";
import { useForm } from "@mantine/form";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { currentMonth, formatBRL } from "../../lib/format";
import { useTaxonomyLabel } from "../../i18n/taxonomy";
import type { Category, Expense, FoodSummary } from "../../api/types";

function monthToDate(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

const TREND_COLORS = ["teal.6", "orange.6", "grape.6", "blue.6", "red.6", "lime.6"];

export function FoodPage() {
  const { t } = useTranslation();
  const tx = useTaxonomyLabel();
  const [month, setMonth] = useState<string>(currentMonth());
  const qc = useQueryClient();
  const isMobile = useMediaQuery("(max-width: 48em)");

  const { data, isLoading } = useQuery({
    queryKey: ["food", month],
    queryFn: () => api.get<FoodSummary>(`/food/?month=${month}&months=6`),
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories/"),
  });

  const form = useForm({
    initialValues: {
      amount: "" as string | number,
      date: new Date(),
      category_id: "" as string,
    },
    validate: {
      amount: (v) => (Number(v) > 0 ? null : t("food.errAmount")),
      category_id: (v) => (v ? null : t("food.errCategory")),
    },
  });

  const quickAddMutation = useMutation({
    mutationFn: (values: typeof form.values) =>
      api.post<Expense>("/expenses/", {
        amount: String(values.amount),
        occurred_at: new Date(
          values.date.getFullYear(),
          values.date.getMonth(),
          values.date.getDate(),
          12
        ).toISOString(),
        category_id: Number(values.category_id),
        description: "",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["food"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      notifications.show({ message: t("food.added"), color: "teal" });
      form.reset();
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const foodCategoryOptions = (categories ?? [])
    .filter((c) => c.topic.is_food)
    .map((c) => ({ value: String(c.id), label: tx(c.name) }));

  const prevTotal =
    data && data.trend.length > 1 ? data.trend[data.trend.length - 2].total : null;
  const delta =
    data && prevTotal ? ((data.total - prevTotal) / prevTotal) * 100 : null;

  const byCategory =
    data?.by_category.map((c) => ({
      name: tx(c.name),
      Total: c.total,
    })) ?? [];

  const trendCategories = Array.from(
    new Set(
      (data?.trend ?? []).flatMap((m) => m.by_category.map((c) => tx(c.name)))
    )
  );
  const trendRows =
    data?.trend.map((m) => {
      const row: Record<string, string | number> = { month: m.month.slice(5) };
      for (const name of trendCategories) row[name] = 0;
      for (const c of m.by_category) row[tx(c.name)] = c.total;
      return row;
    }) ?? [];
  const trendSeries = trendCategories.map((name, i) => ({
    name,
    color: TREND_COLORS[i % TREND_COLORS.length],
  }));

  return (
    <Stack gap="lg">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Title order={2}>{t("food.title")}</Title>
        <MonthPickerInput
          value={monthToDate(month)}
          onChange={(d) =>
            d &&
            setMonth(
              `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
            )
          }
          w={{ base: "100%", sm: 200 }}
        />
      </div>

      {isLoading || !data ? (
        <Loader />
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Card withBorder padding="lg" radius="md">
              <Text c="dimmed" size="sm">
                {t("food.monthTotal")}
              </Text>
              <Text fw={700} size="2rem">
                {formatBRL(data.total)}
              </Text>
              {delta !== null && (
                <Badge color={delta > 0 ? "red" : "teal"} variant="light" mt="xs">
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(0)}% {t("food.vsLastMonth")}
                </Badge>
              )}
            </Card>

            <Card withBorder padding="lg" radius="md">
              <Text c="dimmed" size="sm" mb="xs">
                {t("food.quickAdd")}
              </Text>
              <form onSubmit={form.onSubmit((v) => quickAddMutation.mutate(v))}>
                <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end">
                  <NumberInput
                    label={t("food.amount")}
                    decimalScale={2}
                    fixedDecimalScale
                    min={0}
                    w={{ base: "100%", sm: 140 }}
                    {...form.getInputProps("amount")}
                  />
                  <DatePickerInput
                    label={t("food.date")}
                    valueFormat="DD/MM/YYYY"
                    w={{ base: "100%", sm: 150 }}
                    {...form.getInputProps("date")}
                  />
                  <Select
                    label={t("food.category")}
                    data={foodCategoryOptions}
                    w={{ base: "100%", sm: 180 }}
                    {...form.getInputProps("category_id")}
                  />
                  <Button
                    type="submit"
                    loading={quickAddMutation.isPending}
                    w={{ base: "100%", sm: "auto" }}
                  >
                    {t("food.add")}
                  </Button>
                </div>
              </form>
            </Card>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Card withBorder padding="lg" radius="md">
              <Title order={4} mb="md">
                {t("food.byCategory")}
              </Title>
              {byCategory.length ? (
                <BarChart
                  h={220}
                  data={byCategory}
                  dataKey="name"
                  orientation="vertical"
                  series={[{ name: "Total", color: "teal.6" }]}
                  valueFormatter={formatBRL}
                  withBarValueLabel
                  xAxisProps={{
                    domain: [0, (max: number) => Math.ceil(max * (isMobile ? 1.7 : 1.3))],
                  }}
                  yAxisProps={{ width: isMobile ? 90 : 150 }}
                  tooltipAnimationDuration={150}
                />
              ) : (
                <Text c="dimmed">{t("food.noSpending")}</Text>
              )}
            </Card>

            <Card withBorder padding="lg" radius="md">
              <Title order={4} mb="md">
                {t("food.trend")}
              </Title>
              {data.trend.some((m) => m.total > 0) ? (
                <BarChart
                  h={220}
                  data={trendRows}
                  dataKey="month"
                  type="stacked"
                  series={trendSeries}
                  valueFormatter={formatBRL}
                  yAxisProps={{ width: isMobile ? 64 : 80 }}
                  tooltipAnimationDuration={150}
                />
              ) : (
                <Text c="dimmed">{t("food.noSpending")}</Text>
              )}
            </Card>
          </SimpleGrid>
        </>
      )}
    </Stack>
  );
}
