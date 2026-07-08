"use client";

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
        throw new Error(m.error ?? "邀请失败");
      }
      setOpen(false);
      setName("");
      setEmail("");
      setRole("viewer");
      onInvited();
    } catch (e) {
      setError(e instanceof Error ? e.message : "邀请失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="gradient" size="sm">
          <UserPlus className="h-4 w-4" /> 邀请成员
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>邀请成员</DialogTitle>
          <DialogDescription>通过邮箱邀请新成员加入团队，并分配角色。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="i-name">姓名（可选）</Label>
            <Input id="i-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="新成员姓名" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-email">邮箱</Label>
            <Input id="i-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="member@company.com" />
          </div>
          <div className="space-y-2">
            <Label>角色</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin · 管理知识库与成员</SelectItem>
                <SelectItem value="editor">Editor · 编辑知识库与问答</SelectItem>
                <SelectItem value="viewer">Viewer · 只读问答</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button variant="gradient" onClick={submit} disabled={saving || !email.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            发送邀请
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
