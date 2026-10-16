import { motion } from 'framer-motion';
import { CalendarClock, ScanSearch, ShieldCheck, UserCheck } from 'lucide-react';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.35 } },
};

const item = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
};

const TILES = [
  {
    icon: ScanSearch,
    label: 'Query Inspector',
    value: 'students.find({ batch: "A1" })',
    caption: 'Every answer shows the exact query behind it.',
    mono: true,
  },
  {
    icon: UserCheck,
    label: 'Human approval',
    value: '3 actions awaiting sign-off',
    caption: 'Nothing is written to the database without you.',
  },
  {
    icon: CalendarClock,
    label: 'Clash-free timetable',
    value: 'Re-planned in 1.8s',
    caption: 'Constraints solved, every move explained.',
  },
  {
    icon: ShieldCheck,
    label: 'Role-safe data',
    value: 'Fee fields masked for Trainers',
    caption: 'Masking happens server-side, before the model sees it.',
  },
];

export default function ShowcasePanel() {
  return (
    <motion.div className="iq-showcase" variants={container} initial="hidden" animate="show">
      <motion.p className="iq-showcase__eyebrow" variants={item}>
        <span className="iq-live-dot" aria-hidden="true" />
        Agent online · 12 tools registered
      </motion.p>

      <motion.h2 className="iq-showcase__title" variants={item}>
        Every operation,
        <br />
        one intelligent workspace.
      </motion.h2>

      <motion.p className="iq-showcase__text" variants={item}>
        Ask in plain language, verify the query, approve the change. InstituteIQ keeps staff,
        students, fees and timetables in one place.
      </motion.p>

      <motion.div className="iq-bento" variants={container}>
        {TILES.map(({ icon: Icon, label, value, caption, mono }) => (
          <motion.article className="iq-tile" variants={item} key={label}>
            <span className="iq-tile__icon">
              <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
            </span>
            <h3 className="iq-tile__label">{label}</h3>
            <p className={`iq-tile__value${mono ? ' iq-tile__value--mono' : ''}`}>{value}</p>
            <p className="iq-tile__caption">{caption}</p>
          </motion.article>
        ))}
      </motion.div>
    </motion.div>
  );
}
