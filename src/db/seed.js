// Demo data. All dates are relative to today, so due and upcoming sections always
// have content. Outcomes are deliberately overconfident in the 80s and 90s, with
// at least 5 decisions in the 70s, 80s and 90s so those buckets get a real verdict.
//
//   npm run seed    fills an empty journal; refuses to touch one with data in it
//   npm run reset   empties the journal first, then seeds

import { addDays, today } from '../lib/dates.js';
import { counts, deleteEverything, insertSeedDecision } from '../repositories/decisions.js';

const resolved = (outcome, reviewDaysAgo, reflection = null, resolvedDaysAgo = reviewDaysAgo) => ({
  outcome,
  reviewOffset: -reviewDaysAgo,
  reflection,
  resolvedDaysAgo,
});
const open = (reviewOffset) => ({ reviewOffset });

// [created days ago, confidence, title, prediction, context, tags, state]
const DECISIONS = [
  // 50s: 1 of 2 right
  [232, 55, 'Apply for the conference scholarship', 'I will get a place on the scholarship list.', 'Long shot, but the application only takes an evening.', ['career'], resolved('wrong', 190, 'Lots of strong applicants. Worth trying again with a sharper pitch.')],
  [150, 58, 'Sell the old road bike instead of repairing it', 'It will sell within a month for at least half of what I paid.', null, ['money', 'personal'], resolved('right', 118, 'Gone in nine days.')],

  // 60s: 2 of 3 right
  [226, 62, 'Try a four-day work week for one quarter', 'My output will stay about the same on four days.', 'Manager agreed to a trial as long as delivery dates hold.', ['career', 'health'], resolved('right', 135, 'Output held up. The fifth day stopped mattering after week three.')],
  [201, 65, 'Submit a talk to a local meetup', 'The organisers will accept my talk on testing Pug templates.', null, ['career', 'tech'], resolved('right', 170)],
  [120, 68, 'Rewrite the invoicing scripts in TypeScript', 'It will take less than two weekends.', 'The scripts are small, but nobody remembers why half of them exist.', ['tech'], resolved('wrong', 92, 'It took five. Undocumented edge cases, as I should have expected.')],

  // 70s: 4 of 5 right, close to well calibrated
  [218, 74, 'Move the side project from JSON files to SQLite', 'The migration will take one evening and simplify the code.', 'JSON writes are starting to race when two scripts run at once.', ['tech'], resolved('right', 204, 'One evening, and the file-locking hacks are gone.')],
  [176, 75, 'Cook at home on weekdays for a month', 'I will spend at least 20% less on food this month.', null, ['money', 'health'], resolved('right', 142)],
  [160, 76, 'Walk to work instead of taking the tram', 'I will keep it up on at least 4 days a week through winter.', null, ['health'], resolved('wrong', 70, 'Fine until the first week of real snow. Weather was the whole risk.')],
  [104, 78, 'Pay off the car loan early', 'The monthly cash flow relief will be worth more than the savings buffer.', 'Compared against keeping it in the savings account at the current rate.', ['money'], resolved('right', 45)],
  [96, 78, 'Drop the weekly status meeting', 'Nobody will ask to bring it back within two months.', null, ['career'], resolved('right', 35, 'Nobody noticed. A little humbling.')],

  // 80s: 3 of 5 right, overconfident
  [214, 80, 'Take the 3-month contract instead of the permanent role', 'The contract will be extended or lead to a better offer.', 'Permanent role pays less, but it is safe. The contract is more interesting.', ['career', 'money'], resolved('right', 122, 'Extended for six months at a better rate.')],
  [184, 82, 'Switch the team to Angular signals for new components', 'The team will find them simpler than RxJS for local state within a sprint.', null, ['tech', 'career'], resolved('right', 150)],
  [165, 85, 'Fix the flaky integration tests before the release', 'Two days of work will remove nearly all the flakiness.', 'They fail on about one run in five, and everyone has stopped trusting them.', ['tech'], resolved('wrong', 151, 'Two days fixed about half. The rest was a real race in production code.')],
  [132, 86, 'Run a half-marathon in spring', 'I will finish under 2 hours without injury.', 'Currently running 25 km a week. Training plan runs 16 weeks.', ['health', 'personal'], resolved('wrong', 28, 'Knee trouble in week 11. I never had a plan for that.')],
  [100, 88, 'Book the summer flights early', 'Prices will be higher if I wait until May.', null, ['money', 'personal'], resolved('right', 40)],

  // 90s: 3 of 5 right, overconfident
  [205, 90, 'Rent out the spare room', 'We will find a good tenant within three weeks.', null, ['money'], resolved('right', 180)],
  [172, 92, 'Upgrade the database with no downtime', 'The rolling upgrade will finish with no user-visible errors.', 'Did the same on staging twice without any trouble.', ['tech'], resolved('wrong', 158, 'Staging has none of the long-running reports that blocked the lock.')],
  [140, 95, 'Finish the certification before the end of the quarter', 'I will pass on the first attempt.', null, ['career'], resolved('right', 105)],
  [112, 95, 'Ship the billing rewrite before the holidays', 'It will be live with a week to spare.', 'The scope looks small. Only two integrations left.', ['tech', 'career'], resolved('wrong', 60, 'The two integrations were the whole project. Slipped by five weeks.')],
  [80, 97, 'Keep the current flat for another year', 'The renewal will come with an increase of 5% or less.', null, ['money', 'personal'], resolved('right', 25)],

  // Unclear: counted, but excluded from calibration
  [125, 70, 'Start journaling decisions', 'I will make noticeably better calls within a few months.', 'Hard to measure, which is rather the point of starting.', ['personal'], resolved('unclear', 15, 'Too early to tell, and "better" was too vague a prediction.')],

  // Due: one overdue, one a few days old, one today
  [64, 72, 'Move savings into the index fund in stages', 'Staging it over six months will feel easier, with no real difference in return.', null, ['money'], open(-12)],
  [46, 83, 'Say no to the extra on-call rotation', 'It will cost me no goodwill with the team.', 'I have covered more than my share this year.', ['career', 'health'], open(-3)],
  [30, 64, 'Learn enough Rust to rewrite the CLI', 'I will have a working port by the review date.', null, ['tech'], open(0)],

  // Coming up within two weeks, and one further out
  [22, 77, 'Switch to a standing desk for a month', 'My back will hurt less by the end of the month.', null, ['health'], open(5)],
  [18, 91, 'Renew the home insurance with the current provider', 'No competitor will beat it by more than 10%.', null, ['money'], open(11)],
  [8, 60, 'Propose a mentoring programme at work', 'At least three people will sign up in the first round.', 'Two have already asked informally.', ['career'], open(75)],
];

const timestamp = (daysAgo) => `${addDays(today(), -daysAgo)} 09:00:00`;

export function seed() {
  for (const [createdDaysAgo, confidence, title, prediction, context, tags, state] of DECISIONS) {
    const isResolved = state.outcome !== undefined;
    insertSeedDecision(
      {
        title,
        prediction,
        context,
        confidence,
        review_on: addDays(today(), state.reviewOffset),
        status: isResolved ? 'resolved' : 'open',
        outcome: isResolved ? state.outcome : null,
        reflection: isResolved ? state.reflection : null,
        resolved_at: isResolved ? timestamp(state.resolvedDaysAgo) : null,
        created_at: timestamp(createdDaysAgo),
      },
      tags,
    );
  }
  return DECISIONS.length;
}

const force = process.argv.includes('--reset');
const { open: openCount, resolved: resolvedCount } = counts();

if (force) {
  deleteEverything();
} else if (openCount + resolvedCount > 0) {
  console.log('The journal already has data, so nothing was added. Use "npm run reset" to replace it.');
  process.exit(0);
}

console.log(`Seeded ${seed()} decisions.`);
