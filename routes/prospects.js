const express = require('express');
const router = express.Router();
const p = require('../db/prospects');

// There is deliberately no DELETE route on this resource. A lead retires via
// POST /:id/grade with grade 'bad', which records a reason and keeps the row.
// See db/prospects.js for the rest of the never-delete guarantee.

const OUTCOMES = ['no_answer', 'voicemail', 'gatekeeper', 'connected', 'callback',
                  'not_interested', 'meeting_set'];

// The db layer silently no-ops on an unknown id. Routes must not: a bad id is a 404,
// not a quiet 200 that looks like it worked.
function findOr404(req, res) {
  const row = p.getProspectById(Number(req.params.id));
  if (!row) {
    res.status(404).json({ error: 'Prospect not found' });
    return null;
  }
  return row;
}

// Declared before /:id so 'due' and 'stats' are not read as ids.
router.get('/due', (_req, res) => {
  res.json(p.getDueToday());
});

router.get('/stats', (_req, res) => {
  const all = p.getProspects();
  res.json({
    total: all.length,
    ungraded: all.filter((r) => r.status === 'new').length,
    qualified: all.filter((r) => r.status === 'qualified').length,
    disqualified: all.filter((r) => r.status === 'disqualified').length,
    due: p.getDueToday().length,
  });
});

router.get('/cadence', (_req, res) => {
  res.json(p.getCadence());
});

router.get('/', (req, res) => {
  const { status, stage, trade, city } = req.query;
  res.json(p.getProspects({ status, stage, trade, city }));
});

router.get('/:id', (req, res) => {
  const row = findOr404(req, res);
  if (!row) return;
  res.json({ ...row, activities: p.getActivities(row.id) });
});

router.post('/:id/grade', (req, res) => {
  const row = findOr404(req, res);
  if (!row) return;

  const { grade, grade_why } = req.body;

  // A rejection without a reason teaches us nothing, so the reason is required here
  // rather than optional. This is the only path that retires a lead.
  if (grade === 'bad') {
    if (!grade_why || !String(grade_why).trim()) {
      return res.status(400).json({ error: 'Tell me why. A rejection without a reason teaches us nothing.' });
    }
    return res.json(p.disqualifyProspect(row.id, grade_why));
  }

  if (!['good', 'maybe'].includes(grade)) {
    return res.status(400).json({ error: "grade must be 'good', 'maybe', or 'bad'" });
  }
  res.json(p.gradeProspect(row.id, { grade, grade_why: grade_why || null }));
});

router.post('/:id/touch', (req, res) => {
  const row = findOr404(req, res);
  if (!row) return;

  const { outcome, notes, rep } = req.body;
  if (!OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `outcome must be one of: ${OUTCOMES.join(', ')}` });
  }

  try {
    res.json(p.recordTouch(row.id, { outcome, notes: notes || null, rep: rep || null }));
  } catch (err) {
    // recordTouch throws once a lead has run out of cadence steps.
    res.status(409).json({ error: err.message });
  }
});

module.exports = router;
