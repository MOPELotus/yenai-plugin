import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import vm from "node:vm"
import { resolveNoticeMember } from "../model/noticeMember.js"

test("uses available event/member metadata without querying the API", async () => {
  const result = await resolveNoticeMember({
    nickname: "Past", member: { card: "Group card" }
  }, { pickFriend() { throw new Error("must not query") } })
  assert.deepEqual(result, { nickname: "Past", card: "Group card" })
})

test("awaits member information when the raw notice omits its nickname", async () => {
  const result = await resolveNoticeMember({
    member: { getInfo: async () => ({ nickname: "Joined", card: "Card" }) }
  }, {})
  assert.deepEqual(result, { nickname: "Joined", card: "Card" })
})

test("falls back to the event account's stranger lookup after a member leaves", async () => {
  const result = await resolveNoticeMember({
    user_id: 300,
    member: { card: "Cached card", getInfo: async () => { throw new Error("no longer a member") } }
  }, {
    pickFriend(user) {
      assert.equal(user, 300)
      return { getInfo: async () => ({ nickname: "Leaving" }) }
    }
  })
  assert.deepEqual(result, { nickname: "Leaving", card: "Cached card" })
})

test("missing data or failed APIs do not break notifications or invent group cards", async () => {
  const result = await resolveNoticeMember({ user_id: 300 }, {
    pickFriend: () => ({ getInfo: async () => { throw new Error("unavailable") } })
  })
  assert.equal(result.nickname, undefined)
  assert.equal(result.card, undefined)
})

const source = fs.readFileSync(new URL("../apps/events/notice_group.js", import.meta.url), "utf8")
  .replace(/^import .*\n/gm, "")

function notifier() {
  let listener
  const messages = []
  vm.runInNewContext(source, {
    Bot: { on: (name, handler) => { listener = handler } },
    common: { sendMasterMsg: async (message, bot) => messages.push({ text: message.join(""), bot }) },
    Config: { getNotice: () => ({ groupMemberNumberChange: true }) },
    Log_Prefix: "test",
    logger: { info() {} },
    segment: { image: () => "" },
    resolveNoticeMember
  })
  return { listener, messages }
}

test("join notification displays a fetched nickname and targets the correct account", async () => {
  const { listener, messages } = notifier()
  await listener({
    self_id: 100, group_id: 200, user_id: 300, sub_type: "increase",
    bot: { uin: 100 }, member: { getInfo: async () => ({ nickname: "Past" }) }
  })
  assert.match(messages[0].text, /新成员昵称：Past/)
  assert.equal(messages[0].bot, 100)
})

test("departure notification uses the preserved snapshot without an API lookup", async () => {
  const { listener, messages } = notifier()
  await listener({
    self_id: 100, group_id: 200, user_id: 300, operator_id: 300, sub_type: "decrease",
    bot: { uin: 100 }, member: { nickname: "Leaving", card: "Old card" }
  })
  assert.match(messages[0].text, /退群人昵称：Leaving/)
  assert.match(messages[0].text, /退群人群名片：Old card/)
})

test("disabled notifications do not fetch profile data or send messages", async () => {
  const { listener, messages } = notifier()
  await listener({
    self_id: 100, group_id: 200, user_id: 100, sub_type: "increase",
    bot: { uin: 100, pickFriend() { throw new Error("must not query") } }
  })
  assert.equal(messages.length, 0)
})
