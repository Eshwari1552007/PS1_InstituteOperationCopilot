import { motion, useReducedMotion } from 'framer-motion';
import '../theme/auth.css';
import './LoginPage.css';
import InteractiveBackground from './InteractiveBackground';
import GlassCard from './GlassCard';
import AuthForm from './AuthForm';
import ShowcasePanel from './ShowcasePanel';
import useMediaQuery from '../hooks/useMediaQuery';
import usePointer from '../hooks/usePointer';

export default function LoginPage({ onAuthenticated }) {
  const reducedMotion = Boolean(useReducedMotion());
  const compact = useMediaQuery('(max-width: 1080px)');

  // Global pointer custom properties power the spotlight, parallax and grid.
  usePointer(!reducedMotion && !compact);

  return (
    <div className="iq-shell">
      <InteractiveBackground reducedMotion={reducedMotion} compact={compact} />

      <main className="iq-stage">
        <section className="iq-stage__hero">{!compact && <ShowcasePanel />}</section>

        <section className="iq-stage__auth">
          <motion.div
            className="iq-card-float"
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
          >
            <GlassCard className="iq-card">
              <AuthForm onAuthenticated={onAuthenticated} />
            </GlassCard>
          </motion.div>

          <footer className="iq-footer">
            <span>© {new Date().getFullYear()} InstituteIQ</span>
            <nav className="iq-footer__links" aria-label="Legal">
              <a href="#privacy">Privacy</a>
              <a href="#terms">Terms</a>
              <a href="#security">Security</a>
            </nav>
          </footer>
        </section>
      </main>
    </div>
  );
}
