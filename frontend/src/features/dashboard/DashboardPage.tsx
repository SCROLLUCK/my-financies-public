import { useState } from "react";
import {
  Badge,
  Card,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import { BarChart, ChartTooltip } from "@mantine/charts";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { currentMonth, formatBRL, formatDateTime } from "../../lib/format";
import { useTaxonomyLabel } from "../../i18n/taxonomy";
import type { Dashboard } from "../../api/types";

function monthToDate(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

const CATEGORY_COLORS = [
  "teal.6", "orange.6", "grape.6", "blue.6", "red.6",
  "lime.6", "cyan.6", "pink.6", "yellow.6", "indigo.6",
];

export function DashboardPage() {
  const { t } = useTranslation();
  const tx = useTaxonomyLabel();
  const [month, setMonth] = useState<string>(currentMonth());
  const isMobile = useMediaQuery("(max-width: 48em)");

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", month],
    queryFn: () => api.get<Dashboard>(`/dashboard/?month=${month}`),
  });

  const delta =
    data && data.prev_month_total > 0
      ? ((data.total_so_far - data.prev_month_total) / data.prev_month_total) * 100
      : null;

  // Stacked by topic (bar) x category (segment) so both levels show in one chart.
  const categoryNames = Array.from(
    new Set((data?.by_category ?? []).map((c) => tx(c.category_name)))
  );
  const categorySeries = categoryNames.map((name, i) => ({
    name,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));
  const byTopic = (data?.by_topic ?? []).map((topic) => {
    const row: Record<string, string | number> = { name: tx(topic.name) };
    for (const name of categoryNames) row[name] = 0;
    for (const c of data?.by_category ?? []) {
      if (c.topic_id === topic.topic_id) row[tx(c.category_name)] = c.total;
    }
    return row;
  });

  const bars =
    data?.by_day.map((d) => ({ day: d.date.slice(8), Total: d.total })) ?? [];

  return (
    <Stack gap="lg">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Title order={2}>{t("dashboard.title")}</Title>
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
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Card withBorder padding="lg" radius="md">
              <Text c="dimmed" size="sm">
                {t("dashboard.totalSoFar")}
              </Text>
              <Text fw={700} size="2rem">
                {formatBRL(data.total_so_far)}
              </Text>
              {delta !== null && (
                <Badge color={delta > 0 ? "red" : "teal"} variant="light" mt="xs">
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(0)}% {t("dashboard.vsLastMonth")}
                </Badge>
              )}
            </Card>

            <Card withBorder padding="lg" radius="md">
              <Text c="dimmed" size="sm">
                {t("dashboard.lastMonthTotal")}
              </Text>
              <Text fw={700} size="2rem">
                {formatBRL(data.prev_month_total)}
              </Text>
            </Card>

            <Card withBorder padding="lg" radius="md">
              <Text c="dimmed" size="sm">
                {t("dashboard.upcomingBills")}
              </Text>
              <Text fw={700} size="2rem">
                {data.upcoming_bills.length}
              </Text>
            </Card>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Card withBorder padding="lg" radius="md">
              <Title order={4} mb="md">
                {t("dashboard.spendingByTopic")}
              </Title>
              {byTopic.length ? (
                <BarChart
                  h={220}
                  data={byTopic}
                  dataKey="name"
                  orientation="vertical"
                  type="stacked"
                  series={categorySeries}
                  valueFormatter={formatBRL}
                  withBarValueLabel
                  valueLabelProps={(series) =>
                    series.name === categoryNames[categoryNames.length - 1]
                      ? {
                          // Positioned by the last stacked segment's rect, whose
                          // right edge sits at the bar's cumulative total.
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          content: (props: any) => {
                            // recharts strips non-SVG props (like `payload`) before this
                            // runs, but `index` survives — look the row total up by index.
                            const row = byTopic[props.index];
                            const total = categoryNames.reduce(
                              (sum, name) => sum + (Number(row?.[name]) || 0),
                              0
                            );
                            if (!total) return null;
                            return (
                              <text
                                x={Number(props.x ?? 0) + Number(props.width ?? 0) + 8}
                                y={Number(props.y ?? 0) + Number(props.height ?? 0) / 2}
                                dy={4}
                                fontSize={12}
                                fill="var(--mantine-color-dimmed)"
                              >
                                {formatBRL(total)}
                              </text>
                            );
                          },
                        }
                      : { content: () => null }
                  }
                  xAxisProps={{
                    domain: [0, (max: number) => Math.ceil(max * (isMobile ? 1.7 : 1.3))],
                  }}
                  yAxisProps={{ width: isMobile ? 90 : 150 }}
                  tooltipAnimationDuration={150}
                  tooltipProps={{
                    content: ({ active, label, payload }) => {
                      const nonZero = (payload ?? []).filter(
                        (item: { value?: number }) => Number(item.value) > 0
                      );
                      if (!active || !nonZero.length) return null;
                      return (
                        <ChartTooltip
                          label={label}
                          payload={nonZero}
                          valueFormatter={formatBRL}
                        />
                      );
                    },
                  }}
                />
              ) : (
                <Text c="dimmed">{t("dashboard.noSpending")}</Text>
              )}
            </Card>

            <Card withBorder padding="lg" radius="md">
              <Title order={4} mb="md">
                {t("dashboard.spendingPerDay")}
              </Title>
              {bars.some((b) => b.Total > 0) ? (
                <BarChart
                  h={220}
                  data={bars}
                  dataKey="day"
                  series={[{ name: "Total", color: "teal.6" }]}
                  valueFormatter={formatBRL}
                  yAxisProps={{ width: isMobile ? 64 : 80 }}
                  tooltipAnimationDuration={150}
                />
              ) : (
                <Text c="dimmed">{t("dashboard.noSpending")}</Text>
              )}
            </Card>
          </SimpleGrid>

          <Card withBorder padding="lg" radius="md">
            <Title order={4} mb="md">
              {t("dashboard.upcomingOverdue")}
            </Title>
            {data.upcoming_bills.length ? (
              <Stack gap="xs">
                {data.upcoming_bills.map((b) => (
                  <Group key={b.id} justify="space-between">
                    <Group gap="sm">
                      <Text>{b.name}</Text>
                      {b.is_overdue && <Badge color="red">{t("common.overdue")}</Badge>}
                    </Group>
                    <Group gap="lg">
                      <Text c="dimmed" size="sm">
                        {formatDateTime(b.due_date)}
                      </Text>
                      <Text fw={600}>{formatBRL(b.amount)}</Text>
                    </Group>
                  </Group>
                ))}
              </Stack>
            ) : (
              <Text c="dimmed">{t("dashboard.nothingPending")}</Text>
            )}
          </Card>
        </>
      )}
    </Stack>
  );
}
