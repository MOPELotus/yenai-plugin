const titles = {
  join: "🟢 新成员加入",
  leave: "⚪ 成员离开",
  kick: "🟠 成员被移出",
  botJoin: "🟢 机器人加入群聊",
  botLeave: "⚪ 机器人退出群聊",
  botKick: "🔴 机器人被移出",
  dismiss: "🔴 群聊已解散"
}

// 昵称、名片可能包含换行，保持每个字段占一行。
function oneLine(value) {
  return String(value ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").trim()
}

export function memberNoticeText(e, kind, member = {}) {
  const group = oneLine(e.group_name || e.group?.name || e.group?.group_name) || "群名称暂不可用"
  const nickname = oneLine(member.nickname)
  const card = oneLine(member.card)
  const lines = [
    titles[kind],
    "────────────",
    `群聊：${group}`,
    `群号：${e.group_id}`
  ]
  if ([ "join", "leave", "kick" ].includes(kind)) {
    lines.push(`成员：${nickname ? `${nickname}（${e.user_id}）` : e.user_id}`)
    if (card && card !== nickname) lines.push(`名片：${card}`)
  }
  if (kind === "join") {
    if (e.increase_type === "invite") lines.push("方式：邀请入群")
    else if (e.increase_type === "approve") lines.push("方式：申请通过")
    if (e.inviter_id) lines.push(`邀请人：${e.inviter_id}`)
  } else if ([ "kick", "botKick", "dismiss" ].includes(kind) && e.operator_id) {
    lines.push(`操作人：${e.operator_id}`)
  }
  const timestamp = Number(e.time)
  const date = new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : Date.now())
  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(date)
  lines.push("", `时间：${time}`, `机器人：${e.self_id}`)
  return lines.join("\n")
}
