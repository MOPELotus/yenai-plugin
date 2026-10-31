import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import vm from "node:vm"

const source = fs.readFileSync(new URL("../apps/groupAdmin/groupVerify.js", import.meta.url), "utf8")
  .replace(/^import .*\n/gm, "")
  .replace("export class GroupVerify", "class GroupVerify")

function setup({ allowed = true, inviterRole = "admin", inviteLookupFails = false } = {}) {
  const listeners = new Map()
  const timers = new Map()
  const sent = []
  let queriedMembers = 0
  let timerId = 0
  let randomIndex = 0
  const group = {
    is_owner: true,
    sendMsg: async msg => { sent.push(msg); return { message_id: sent.length } },
    pickMember: () => {
      if (inviteLookupFails) throw new Error("lookup failed")
      return { role: inviterRole }
    }
  }
  const bot = { uin: 100, pickGroup: id => { assert.equal(id, 200); return group } }
  const Config = {
    masterQQ: [],
    groupAdmin: {
      whiteQQ: [],
      groupVerify: {
        openGroup: [200], DelayTime: 0, mode: "精确", SuccessMsgs: { 0: "Default welcome", 200: "Group welcome" },
        times: 3, range: { min: 10, max: 20 }, time: 300, remindAtLastMinute: true
      }
    }
  }
  const api = vm.runInNewContext(`${source}\n({ GroupVerify, sendMsg, verify, temp })`, {
    Config, Log_Prefix: "test",
    common: { checkPermission: () => allowed },
    Ga: class { async getNeverSpeak() { queriedMembers++; return [] } },
    plugin: class { constructor(options) { Object.assign(this, options) } },
    _: { random: () => [0, 10, 20][randomIndex++ % 3] },
    Bot: { 100: bot, on: (name, handler) => listeners.set(name, handler) },
    logger: { mark() {}, debug() {}, error() {} },
    segment: { at: user => `@${user}` },
    sleep: async () => {},
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id },
    clearTimeout: id => timers.delete(id)
  })
  const event = { bot, self_id: 100, group_id: 200, user_id: 300, group }
  return { ...api, event, listeners, timers, sent, Config, queriedMembers: () => queriedMembers }
}

test("bot-only events can send through pickGroup without a reply helper", async () => {
  const { sendMsg, event, sent } = setup()
  await sendMsg({ bot: event.bot, group_id: 200 }, "Welcome")
  assert.equal(sent[0], "Welcome")
})

test("self_id fallback uses the account's correctly spelled pickGroup method", async () => {
  const { sendMsg, sent } = setup()
  await sendMsg({ self_id: 100, group_id: 200 }, "Welcome")
  assert.equal(sent[0], "Welcome")
})

test("a false reply result falls back to the group sender", async () => {
  const { sendMsg, event, sent } = setup()
  await sendMsg({ ...event, reply: async () => false }, "Welcome")
  assert.equal(sent[0], "Welcome")
})

test("failed verification prompts never leave kick/reminder timers armed", async () => {
  const { verify, event, timers, temp } = setup()
  event.group.sendMsg = async () => { throw new Error("cannot send") }
  await assert.rejects(verify(300, 200, event), /未获取到发送消息函数/)
  assert.equal(timers.size, 0)
  assert.equal(Object.keys(temp).length, 0)
})

test("automatic prompt failures are handled without unhandled rejections", async () => {
  const { event, listeners, timers } = setup()
  event.group.sendMsg = async () => { throw new Error("cannot send") }
  await listeners.get("notice.group.increase")(event)
  assert.equal(timers.size, 0)
})

test("successful answers send the group's configured welcome and clear timers", async () => {
  const { verify, event, listeners, timers, temp, sent } = setup()
  await verify(300, 200, event)
  assert.equal(timers.size, 2)
  const answer = temp["200:300"].verifyCode
  await listeners.get("message.group")({ ...event, raw_message: answer })
  assert.equal(sent.at(-1), "Group welcome")
  assert.equal(timers.size, 0)
  assert.equal(Object.keys(temp).length, 0)
})

test("owner and administrator invitations bypass verification", async () => {
  for (const inviterRole of ["owner", "admin"]) {
    const { event, listeners, sent, timers } = setup({ inviterRole })
    await listeners.get("notice.group.increase")({ ...event, increase_type: "invite", operator_id: 400 })
    assert.equal(sent.length, 0)
    assert.equal(timers.size, 0)
  }
})

test("administrator approval of an application still requires verification", async () => {
  const { event, listeners, sent, timers } = setup()
  await listeners.get("notice.group.increase")({ ...event, increase_type: "approve", operator_id: 400 })
  assert.equal(sent.length, 1)
  assert.equal(timers.size, 2)
})

test("ordinary or unverified inviters cannot bypass verification", async () => {
  for (const config of [{ inviterRole: "member" }, { inviteLookupFails: true }]) {
    const { event, listeners, sent } = setup(config)
    await listeners.get("notice.group.increase")({ ...event, inviter_id: 400 })
    assert.equal(sent.length, 1)
  }
})

test("ordinary members cannot trigger mass reverification", async () => {
  const { GroupVerify, event, queriedMembers } = setup({ allowed: false })
  await new GroupVerify().cmdReverifyNeverSpeak(event)
  assert.equal(queriedMembers(), 0)
})

test("mass reverification remains unavailable in groups without verification enabled", async () => {
  const { GroupVerify, event, queriedMembers, Config } = setup()
  Config.groupAdmin.groupVerify.openGroup = []
  let reply
  event.reply = async text => { reply = text }
  await new GroupVerify().cmdReverifyNeverSpeak(event)
  assert.equal(queriedMembers(), 0)
  assert.match(reply, /当前群未开启验证/)
})
