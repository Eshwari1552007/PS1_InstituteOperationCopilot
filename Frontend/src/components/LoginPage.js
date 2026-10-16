import { motion, useReducedMotion } from 'framer-motion';
import '../theme/auth.css';
import './LoginPage.css';
import AuthCard from './AuthCard';
import AuthForm from './AuthForm';
import BrandPanel from './BrandPanel';
import useParallax from '../hooks/useParallax';

export default function LoginPage({ onAuthenticated }) {
  const reducedMotion = Boolean(useReducedMotion());
  useParallax(!reducedMotion);

  return (
    <div className="ax-shell">
      <main className="ax-stage">
        <BrandPanel />

        <section className="ax-panel" aria-label="Sign in">
          <motion.div
            className="ax-panel__inner"
            initial={reducedMotion ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <AuthCard>
              <AuthForm onAuthenticated={onAuthenticated} />
            </AuthCard>

            <footer className="ax-foot">
              <span>© {new Date().getFullYear()} EDUPILOT</span>
              <nav className="ax-foot__links" aria-label="Legal">
                <a href="#privacy">Privacy</a>
                <a href="#terms">Terms</a>
                <a href="#security">Security</a>
              </nav>
            </footer>
          </motion.div>
        </section>
      </main>
    </div>
  );
}
