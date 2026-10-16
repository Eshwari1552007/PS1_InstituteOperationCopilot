import { motion } from 'framer-motion';
import { CalendarDays, GraduationCap, ShieldCheck, Sparkles } from 'lucide-react';
import Logo from './Logo';
import campus from '../assets/campus_new.jpg';
import './BrandPanel.css';

const FEATURES = [
  {
    icon: GraduationCap,
    title: 'Student Management',
    text: 'Complete student lifecycle',
  },
  {
    icon: CalendarDays,
    title: 'Smart Timetables',
    text: 'Automatic scheduling & re-planning',
  },
  {
    icon: ShieldCheck,
    title: 'Secure & Transparent',
    text: 'Role-based access, approvals & audit logs',
  },
  {
    icon: Sparkles,
    title: 'AI-Powered Operations',
    text: 'Ask, analyze, approve, automate',
  },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.04 } },
};

const listContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

export default function BrandPanel() {
  return (
    <section className="ax-visual" aria-label="About EDUPILOT">
      <div
        className="ax-visual__art"
        style={{ backgroundImage: `url(${campus})` }}
        aria-hidden="true"
      />
      <div className="ax-visual__veil" aria-hidden="true" />

      <motion.div
        className="ax-visual__inner"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <motion.div className="ax-brand" variants={item}>
          <Logo size={28} />
          <span className="ax-brand__name">
            EDUPILOT
          </span>
        </motion.div>

        <motion.p className="ax-visual__subhead" variants={item}>
          ONE PLATFORM. EVERY OPERATION.
        </motion.p>

        <motion.h1 className="ax-headline" variants={item}>
          Smarter Institutes With AI.
        </motion.h1>

        <motion.p className="ax-lede" variants={item}>
          Manage students, fees, attendance, timetables and more — with the power of Agentic AI.
        </motion.p>

        <motion.ul className="ax-features" variants={listContainer}>
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <motion.li className="ax-feature" key={title} variants={item}>
              <span className="ax-feature__icon" aria-hidden="true">
                <Icon size={18} strokeWidth={1.7} />
              </span>
              <span className="ax-feature__body">
                <span className="ax-feature__title">{title}</span>
                <span className="ax-feature__text">{text}</span>
              </span>
            </motion.li>
          ))}
        </motion.ul>

        <motion.div className="ax-visual__tagline" variants={item}>
          PEOPLE + DATA + AI = A SMARTER TOMORROW
        </motion.div>
      </motion.div>
    </section>
  );
}
