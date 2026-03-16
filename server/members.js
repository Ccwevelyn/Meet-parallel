// 13 位成员：name 为登录用英文名，displayName 为微信群昵称
const MEMBERS = [
  { id: 'member_1', name: 'Cheng', displayName: '复制粘贴吧黄牌' },
  { id: 'member_2', name: 'Xian', displayName: '离离原上草' },
  { id: 'member_3', name: 'Wang', displayName: '群之共主' },
  { id: 'member_4', name: 'Lin', displayName: 'L.ing' },
  { id: 'member_5', name: 'Gao', displayName: '话痨用户' },
  { id: 'member_6', name: 'Sev', displayName: '小七' },
  { id: 'member_7', name: 'Wu', displayName: '伍子軒' },
  { id: 'member_8', name: 'Evelyn', displayName: 'Looking up at the starry sky' },
  { id: 'member_9', name: 'Morty', displayName: '小可' },
  { id: 'member_10', name: 'Chen', displayName: '石墨烯' },
  { id: 'member_11', name: 'Kang', displayName: '小米康' },
  { id: 'member_12', name: 'Zhang', displayName: 'Tree' },
  { id: 'member_13', name: 'Bao', displayName: '烟火°' }
];

function getMemberById(id) {
  return MEMBERS.find(m => m.id === id);
}

function getMemberByName(name) {
  return MEMBERS.find(m => m.name === name || m.displayName === name);
}

/** 用 id（member_1）或 name（Cheng）都能查到成员，避免前端传错导致 404 */
function getMemberByIdOrName(idOrName) {
  if (!idOrName) return null;
  return getMemberById(idOrName) || getMemberByName(String(idOrName).trim());
}

/** 用 id 或英文名都能查到，统一返回群昵称 displayName（聊天里显示昵称） */
function getDisplayName(memberIdOrName) {
  const m = getMemberByIdOrName(memberIdOrName);
  return (m && m.displayName) ? m.displayName : '';
}

function getAllMembers() {
  return MEMBERS;
}

module.exports = { getMemberById, getMemberByName, getMemberByIdOrName, getDisplayName, getAllMembers };
