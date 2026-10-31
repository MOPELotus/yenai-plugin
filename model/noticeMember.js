/**
 * Resolve the affected user's profile without depending on optional notice fields.
 * @param {object} e Notice event.
 * @param {object} bot Account receiving the event.
 */
export async function resolveNoticeMember(e, bot) {
  const profile = {
    nickname: e.nickname || e.member?.nickname || e.sender?.nickname,
    card: e.member?.card ?? e.sender?.card
  }

  if (!profile.nickname && e.member?.getInfo) {
    try {
      const info = await e.member.getInfo()
      profile.nickname ||= info?.nickname
      profile.card ??= info?.card
    } catch {}
  }

  // Departed members may no longer be queryable through the group API.
  if (!profile.nickname) {
    try {
      const info = await bot.pickFriend(e.user_id).getInfo()
      profile.nickname = info?.nickname
    } catch {}
  }
  return profile
}
