import { Select } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { useTaxonomyLabel } from "../i18n/taxonomy";
import type { Category } from "../api/types";

interface CategoryPickerProps {
  categories: Category[] | undefined;
  topicId: string;
  categoryId: string;
  onTopicChange: (topicId: string) => void;
  onCategoryChange: (categoryId: string) => void;
  error?: React.ReactNode;
}

/** Two cascading selects: topic first, then its categories. */
export function CategoryPicker({
  categories,
  topicId,
  categoryId,
  onTopicChange,
  onCategoryChange,
  error,
}: CategoryPickerProps) {
  const { t } = useTranslation();
  const tx = useTaxonomyLabel();

  const topics = Array.from(
    new Map((categories ?? []).map((c) => [c.topic.id, c.topic])).values()
  ).sort((a, b) => a.order - b.order);

  const topicOptions = topics.map((tp) => ({
    value: String(tp.id),
    label: tx(tp.name),
  }));

  const categoryOptions = (categories ?? [])
    .filter((c) => String(c.topic.id) === topicId)
    .map((c) => ({ value: String(c.id), label: tx(c.name) }));

  return (
    <>
      <Select
        label={t("common.topic")}
        searchable
        data={topicOptions}
        value={topicId || null}
        onChange={(v) => {
          onTopicChange(v ?? "");
          onCategoryChange("");
        }}
      />
      <Select
        label={t("common.category")}
        searchable
        disabled={!topicId}
        data={categoryOptions}
        value={categoryId || null}
        onChange={(v) => onCategoryChange(v ?? "")}
        error={error}
      />
    </>
  );
}
