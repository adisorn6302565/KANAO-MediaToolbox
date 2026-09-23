// รายการคิวงานพร้อมแถบความคืบหน้าและปุ่มควบคุม (ใช้ในหลายหน้า)
import { Pause, Play, X, RotateCw, ArrowUp, ArrowDown, FolderOpen, Trash2, Square, ExternalLink, Clock } from "lucide-react";
import { api, openPath, revealPath, type Job } from "@/lib/api";
import { useApp } from "@/store/app";
import { Empty, Progress } from "./ui";
import { formatBytes, formatDate } from "@/lib/format";

const STATUS: Record<Job["status"], { label: string; cls: string }> = {
  queued: { label: "รอคิว", cls: "text-muted" },
  running: { label: "กำลังทำ", cls: "text-cyan-300" },
  paused: { label: "หยุดชั่วคราว", cls: "text-amber-300" },
  done: { label: "เสร็จแล้ว", cls: "text-lime-300" },
  failed: { label: "ไม่สำเร็จ", cls: "text-red-300" },
  cancelled: { label: "ยกเลิก", cls: "text-muted" },
};

export function useJobs(kinds?: string[]) {
  const jobs = useApp((s) => s.jobs);
  return Object.values(jobs)
    .filter((j) => !kinds || kinds.includes(j.kind))
    .sort((a, b) => a.priority - b.priority);
}

export function JobRow({ job }: { job: Job }) {
  const act = (a: string) => api.jobAction(job.id, a).catch((e) => useApp.getState().toast(String(e), "error"));
  const st = STATUS[job.status];
  const isRecord = job.kind === "record";
  const scheduled = job.status === "queued" && job.startAt && new Date(job.startAt).getTime() > Date.now();
  return (
    <div className="rounded-xl border border-fg/10 bg-fg/[.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium selectable" title={job.title}>
            {job.title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted">
            <span className={st.cls}>● {scheduled ? "ตั้งเวลาไว้" : st.label}</span>
            {scheduled && (
              <span className="flex items-center gap-1">
                <Clock size={11} /> {formatDate(job.startAt!)}
              </span>
            )}
            {job.speed && <span className="font-mono">{job.speed}</span>}
            {job.eta && job.status === "running" && <span>เหลือ {job.eta}</span>}
            {job.status === "done" && job.sizeAfter > 0 && (
              <span>
                {job.sizeBefore > 0 && `${formatBytes(job.sizeBefore)} → `}
                {formatBytes(job.sizeAfter)}
                {job.sizeBefore > 0 && job.sizeAfter < job.sizeBefore && <b className="ml-1 text-lime-300">-{Math.round((1 - job.sizeAfter / job.sizeBefore) * 100)}%</b>}
              </span>
            )}
            {job.message && job.status !== "running" && <span className={`truncate ${job.status === "failed" ? "text-red-300" : ""}`} title={job.message}>{job.message}</span>}
            {job.status === "running" && job.message && <span>{job.message}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {job.status === "running" && !isRecord && (
            <button className="btn btn-sm" title="หยุดชั่วคราว" onClick={() => act("pause")}>
              <Pause size={13} />
            </button>
          )}
          {job.status === "running" && isRecord && (
            <button className="btn btn-sm text-red-300" title="หยุดอัด" onClick={() => act("stop")}>
              <Square size={13} /> หยุดอัด
            </button>
          )}
          {job.status === "paused" && (
            <button className="btn btn-sm" title="ทำต่อ" onClick={() => act("resume")}>
              <Play size={13} />
            </button>
          )}
          {["failed", "cancelled"].includes(job.status) && (
            <button className="btn btn-sm" title="ลองใหม่" onClick={() => act("retry")}>
              <RotateCw size={13} />
            </button>
          )}
          {job.status === "queued" && (
            <>
              <button className="btn btn-sm" title="เลื่อนขึ้น" onClick={() => act("up")}>
                <ArrowUp size={13} />
              </button>
              <button className="btn btn-sm" title="เลื่อนลง" onClick={() => act("down")}>
                <ArrowDown size={13} />
              </button>
            </>
          )}
          {job.status === "done" && job.output && (
            <>
              <button className="btn btn-sm" title="เปิดไฟล์" onClick={() => openPath(job.output).catch(() => {})}>
                <ExternalLink size={13} />
              </button>
              <button className="btn btn-sm" title="เปิดโฟลเดอร์" onClick={() => revealPath(job.output).catch(() => openPath(job.output))}>
                <FolderOpen size={13} />
              </button>
            </>
          )}
          {["queued", "running", "paused"].includes(job.status) ? (
            <button className="btn btn-sm" title="ยกเลิก" onClick={() => act("cancel")}>
              <X size={13} />
            </button>
          ) : (
            <button className="btn btn-sm" title="ลบออกจากรายการ" onClick={() => act("remove")}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      {["running", "paused"].includes(job.status) && (
        <div className="mt-2 flex items-center gap-2">
          <Progress value={job.progress} />
          <span className="w-12 text-right font-mono text-[11px]">{isRecord ? "REC" : `${job.progress.toFixed(1)}%`}</span>
        </div>
      )}
    </div>
  );
}

export function JobList({ kinds, empty = "ยังไม่มีงานในคิว" }: { kinds?: string[]; empty?: string }) {
  const jobs = useJobs(kinds);
  const hasFinished = jobs.some((j) => ["done", "failed", "cancelled"].includes(j.status));
  if (!jobs.length) return <Empty icon="🗂️" text={empty} />;
  return (
    <div className="space-y-2">
      {hasFinished && (
        <div className="flex justify-end">
          <button className="btn btn-sm" onClick={() => api.jobAction("*", "clear")}>
            ล้างงานที่เสร็จแล้ว
          </button>
        </div>
      )}
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} />
      ))}
    </div>
  );
}
