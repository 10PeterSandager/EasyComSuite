type Group = {
  id: string
  name: string
  members: string[]
}

const groups: Group[] = []

export function createGroup(group: Group) {
  groups.push(group)
}

export function getGroup(id: string) {
  return groups.find(g => g.id === id)
}

export function getGroups() {
  return groups
}