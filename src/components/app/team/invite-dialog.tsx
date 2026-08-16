"use client";

import { useT } from "@/lib/i18n/provider";

import * as React from "react";
import { UserPlus, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Role } from "@/lib/team/types";

export function InviteDialog({ onInvited }: { onInvited: () => void }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("viewer");
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    if (!email.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role }),
      });
      if (!res.ok) {
        const m = await res.json().catch(() => ({}));
        throw new Error(m.error ?? t("page.invite-dialog.s9"));
      }
      setOpen(false);
      setName("");
      setEmail("");
      setRole("viewer");
      onInvited();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("page.invite-dialog.s9"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="gradient" size="sm">
          <UserPlus className="h-4 w-4" /> {t("page.invite-dialog.s11")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("page.invite-dialog.s0")}</DialogTitle>
          <DialogDescription>{t("page.invite-dialog.s1")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="i-name">{t("page.invite-dialog.s2")}</Label>
            <Input id="i-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("page.invite-dialog.s10")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-email">{t("page.invite-dialog.s3")}</Label>
            <Input id="i-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="member@company.com" />
          </div>
          <div className="space-y-2">
            <Label>{t("page.invite-dialog.s4")}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{t("page.invite-dialog.s5")}</SelectItem>
                <SelectItem value="editor">{t("page.invite-dialog.s6")}</SelectItem>
                <SelectItem value="viewer">{t("page.invite-dialog.s7")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("page.invite-dialog.s8")}</Button>
          <Button variant="gradient" onClick={submit} disabled={saving || !email.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {t("page.invite-dialog.s12")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
