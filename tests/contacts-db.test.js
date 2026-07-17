process.env.DB_PATH = ':memory:';
const db = require('../database');
const p = require('../db/prospects');

afterEach(() => db.closeDb());

function lead(over = {}) {
  return p.createProspect({ business_name: 'Ben Ross Roofing', city: 'Charlotte', phone: '7045550148', ...over });
}

test('createContact requires a name', () => {
  const r = lead();
  expect(() => p.createContact({ prospect_id: r.id, name: '   ' })).toThrow();
});

test('createContact and getContacts round-trip, scoped to the prospect', () => {
  const a = lead();
  const b = lead({ business_name: 'Other', phone: '7045550001' });
  p.createContact({ prospect_id: a.id, name: 'Mike Ross', role: 'owner', phone: '7045550148', is_decision_maker: 1 });
  p.createContact({ prospect_id: b.id, name: 'Someone Else' });
  const forA = p.getContacts(a.id);
  expect(forA).toHaveLength(1);
  expect(forA[0].name).toBe('Mike Ross');
  expect(forA[0].is_decision_maker).toBe(1);
});

test('updateContact edits fields', () => {
  const r = lead();
  const c = p.createContact({ prospect_id: r.id, name: 'Mike' });
  const updated = p.updateContact(c.id, { role: 'owner', is_gatekeeper: 1 });
  expect(updated.role).toBe('owner');
  expect(updated.is_gatekeeper).toBe(1);
});

test('deactivateContact hides without deleting', () => {
  const r = lead();
  const c = p.createContact({ prospect_id: r.id, name: 'Gone' });
  const after = p.deactivateContact(c.id);
  expect(after.is_active).toBe(0);
  expect(p.getContactById(c.id)).toBeTruthy(); // row still there
});

test('there is no deleteContact export', () => {
  expect(p.deleteContact).toBeUndefined();
});
