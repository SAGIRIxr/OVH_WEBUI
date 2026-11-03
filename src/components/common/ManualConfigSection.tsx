import { useState } from "react";
import { ChevronDown, PenLine } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** 解析 PLANCODE= / FQN= / OPTIONS= 形式的文本。
 *  兼容 docker-compose 里的「- KEY=value」、.env 的「export KEY=value」、带引号的值和「KEY: value」。 */
export function parseManualConfig(text: string): { planCode?: string; fqn?: string; options?: string } {
  const out: { planCode?: string; fqn?: string; options?: string } = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^-\s*/, "").replace(/^export\s+/i, "");
    const m = line.match(/^([A-Za-z_]+)\s*[=:]\s*(.*)$/);
    if (!m) continue;
    const val = m[2].trim().replace(/^["']|["']$/g, "").trim();
    switch (m[1].toUpperCase()) {
      case "PLANCODE":
      case "PLAN_CODE":
        out.planCode = val;
        break;
      case "FQN":
        out.fqn = val;
        break;
      case "OPTIONS":
        out.options = val;
        break;
    }
  }
  return out;
}

/** OPTIONS 文本 → addon planCode 列表(逗号 / 空白分隔) */
export function splitManualOptions(s: string): string[] {
  return s
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** 手动填写配置:FQN 锁定整套硬件组合,OPTIONS 直接给 addon planCode。
 *  目录里没有的新品没有选项 chip 可点,只能靠这里;目录里有的机型也能用它覆盖选择。
 *  forced 时(自定义型号)常开且不可折叠。 */
export function ManualConfigSection({
  open,
  onOpenChange,
  forced = false,
  planCode,
  onPlanCodeChange,
  fqn,
  onFqnChange,
  options,
  onOptionsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forced?: boolean;
  planCode: string;
  onPlanCodeChange: (planCode: string) => void;
  fqn: string;
  onFqnChange: (fqn: string) => void;
  options: string;
  onOptionsChange: (options: string) => void;
}) {
  const [paste, setPaste] = useState("");
  const expanded = forced || open;

  const applyPaste = (text: string) => {
    setPaste(text);
    const parsed = parseManualConfig(text);
    const hits: string[] = [];
    if (parsed.planCode) {
      onPlanCodeChange(parsed.planCode);
      hits.push("PLANCODE");
    }
    if (parsed.fqn !== undefined) {
      onFqnChange(parsed.fqn);
      hits.push("FQN");
    }
    if (parsed.options !== undefined) {
      onOptionsChange(parsed.options);
      hits.push("OPTIONS");
    }
    if (hits.length > 0) {
      setPaste("");
      toast.success(`已识别 ${hits.join(" / ")}`);
    }
  };

  const code = planCode.trim().toLowerCase();
  const fqnMismatch = fqn.trim() !== "" && code !== "" && !fqn.trim().toLowerCase().startsWith(code + ".");

  return (
    <div className="rounded-xl border border-border">
      {!forced && (
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-[13px] hover:bg-muted/40 rounded-xl transition-colors"
        >
          <span className="flex items-center gap-2">
            <PenLine className="w-3.5 h-3.5 text-muted-foreground" />
            手动填写配置
            <span className="text-[11px] text-muted-foreground">FQN / OPTIONS，填了会覆盖上面的选择</span>
          </span>
          <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      )}
      {expanded && (
        <div className={cn("space-y-3 px-3.5 pb-3.5", forced ? "pt-3.5" : "pt-1")}>
          <div>
            <label className="block text-[12px] font-medium mb-1">快速粘贴</label>
            <Textarea
              value={paste}
              onChange={(e) => applyPaste(e.target.value)}
              rows={3}
              className="font-mono text-[12px]"
              placeholder={"粘贴 PLANCODE= / FQN= / OPTIONS= 这几行，自动拆到下面\n- PLANCODE=27skleb01-v1\n- FQN=27skleb01-v1.ram-32g-ecc-2400.softraid-2x450nvme"}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1">FQN（可选）</label>
            <Input
              value={fqn}
              onChange={(e) => onFqnChange(e.target.value)}
              className="font-mono text-[12px]"
              placeholder={`${code || "<planCode>"}.ram-32g-ecc-2400.softraid-2x450nvme`}
            />
            {fqnMismatch ? (
              <p className="text-[11px] text-amber-500 mt-1">FQN 要以「{code}.」开头，否则提交会被拒绝。</p>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-1">
                锁定整套硬件组合：只在这条 FQN 有货时下单，其它组合有货也继续等。
              </p>
            )}
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1">OPTIONS（可选）</label>
            <Input
              value={options}
              onChange={(e) => onOptionsChange(e.target.value)}
              className="font-mono text-[12px]"
              placeholder="bandwidth-500-27skle, ram-32g-ecc-2400-27skleb01-v1, softraid-2x450nvme-27skleb01-v1"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              加进购物车的 addon planCode，逗号分隔。留空且填了 FQN 时，按 FQN 里的内存、硬盘段自动匹配。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
