// 工作区 + 套餐的全局响应式状态（唯一事实源 = 后端 GET /api/workspaces）。
// 为什么套餐读工作区而不是 user.plan：支付成功时后端只调
// setWorkspacePlan(user.workspaceId, plan)（/api/billing/checkout/[id]），
// users.plan 只在支付时写给付款人（billing/store.ts payOrder → updateUserPlan），
// 工作区其他成员仍是旧值——读 user.plan 会把团队成员显示成免费版
// （侧栏一直挂「升级专业版」、工作台徽标一直显示免费版）。
// 升级/取消后调用 refreshWorkspaces() 即可让侧栏、工作区徽标、工作台同步更新。
import { computed, ref } from "vue";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";

const list = ref<Workspace[]>([]);
const name = ref("");
const loaded = ref(false);

/** 当前用户名下的工作区列表（侧栏切换器直接渲染）。 */
export const workspaceList = list;
/** 当前工作区名称（侧栏标题）。 */
export const currentWorkspaceName = name;
/** 是否已成功取过一次（未取到时不渲染升级引导，避免已付费用户闪现 CTA）。 */
export const workspacesLoaded = loaded;

/** 当前工作区套餐枚举：free / pro / enterprise；空串表示未知。 */
export const currentPlan = computed(() => {
  const active = list.value.find((w) => w.active) ?? list.value[0];
  return active?.plan ?? "";
});

/** 仅「已知且为免费版」才展示升级引导。 */
export const onFreePlan = computed(() => loaded.value && currentPlan.value === "free");

/** 从后端拉取工作区列表 + 当前套餐（升级/取消/进计费页时调用）。 */
export async function refreshWorkspaces(): Promise<void> {
  try {
    const d = await fetchWorkspaces();
    list.value = d.workspaces ?? [];
    name.value = d.currentName ?? "";
    loaded.value = true;
  } catch {
    /* 离线或未登录：保持上次结果，不误判为免费版 */
  }
}
