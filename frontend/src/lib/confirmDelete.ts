import { modals } from "@mantine/modals";
import type { TFunction } from "i18next";

/** Shared delete-confirmation modal (replaces native window.confirm everywhere). */
export function confirmDelete(t: TFunction, message: string, onConfirm: () => void) {
  modals.openConfirmModal({
    title: t("common.confirmDeleteTitle"),
    children: message,
    labels: { confirm: t("common.delete"), cancel: t("common.cancel") },
    confirmProps: { color: "red" },
    onConfirm,
  });
}
