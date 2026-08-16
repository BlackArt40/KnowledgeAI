"use client";

import { useT } from "@/lib/i18n/provider";

import * as React from "react";
import { Settings2, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Team } from "@/lib/team/types";

export function TeamSettingsDialog({
  team,
  onSaved,
}: {
  team: Team;
  onSaved: (t: Team) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState(team.name);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { if (open) setName(team.name); }, [open, team.name]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, logoInitial: name.charAt(0) || "K" }),
      });
      if (!res.ok) throw new Error();
      const { team: updated } = await res.json();
      onSaved(updated);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="h-4 w-4" /> {t("page.team-settings-dialog.s5")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("page.team-settings-dialog.s0")}</DialogTitle>
          <DialogDescription>{t("page.team-settings-dialog.s1")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="t-name">{t("page.team-settings-dialog.s2")}</Label>
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("page.team-settings-dialog.s3")}</Label>
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {t("page.team-settings-dialog.s6", { plan: team.plan })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("page.team-settings-dialog.s4")}</Button>
          <Button variant="gradient" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
