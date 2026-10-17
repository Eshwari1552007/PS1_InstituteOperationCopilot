import { useState } from 'react';
import { BookOpen, CalendarDays, CircleDollarSign, ClipboardCheck, GraduationCap, LayoutDashboard, LogOut, Sparkles, Users } from 'lucide-react';

const MENU = {
  OWNER: [
    ['Dashboard', LayoutDashboard, true], ['Students', GraduationCap], ['Batches & Courses', BookOpen],
    ['Attendance', ClipboardCheck, true], ['Fees & EMI', CircleDollarSign, true], ['Timetable', CalendarDays],
    ['AI Copilot', Sparkles], ['Approvals', Users, true], ['Audit Log', ClipboardCheck],
  ],
  COUNSELOR: [['Dashboard', LayoutDashboard, true], ['Students', GraduationCap], ['Batches & Courses', BookOpen], ['Attendance', ClipboardCheck, true], ['AI Copilot', Sparkles]],
  TRAINER: [['Dashboard', LayoutDashboard, true], ['My Batches', BookOpen], ['Attendance', ClipboardCheck, true], ['Timetable', CalendarDays], ['AI Copilot', Sparkles]],
  ACCOUNTS: [['Dashboard', LayoutDashboard, true], ['Fees & EMI', CircleDollarSign, true], ['Approvals · financial only', Users], ['AI Copilot', Sparkles]],
  STUDENT: [['Student Home', LayoutDashboard, true], ['Attendance', ClipboardCheck, true], ['Timetable', CalendarDays], ['AI Copilot', Sparkles]],
};

export default function RoleSidebar({ profile, onLogout, active, onNavigate }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = MENU[profile.role] || MENU.STUDENT;
  const displayName = profile.name || profile.email || 'EDUPILOT user';

  return (
    <>
      <button className="ep-menu-toggle" type="button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}>
        Menu
      </button>
      <aside className={`ep-sidebar${menuOpen ? ' ep-sidebar--open' : ''}`}>
        <div className="ep-sidebar__brand">EDUPILOT</div>
        <div className="ep-sidebar__user">
          <strong>{displayName}</strong>
          <span>{profile.role}</span>
        </div>
        <nav aria-label="Main navigation" className="ep-nav">
          {menu.map(([label, Icon, enabled]) => {
            const target = label === 'Approvals' ? 'approvals' : label === 'AI Copilot' ? 'copilot' : label === 'Students' ? 'students' : label.includes('Batches') || label === 'My Batches' ? 'batches' : label === 'Attendance' ? 'attendance' : label.includes('Fees') ? 'fees' : label === 'Timetable' ? 'timetable' : 'dashboard';
            const canNavigate = Boolean(enabled)
              || (target === 'students' && ['OWNER', 'COUNSELOR'].includes(profile.role))
              || (target === 'batches' && ['OWNER', 'COUNSELOR', 'TRAINER'].includes(profile.role));
            const finalCanNavigate = canNavigate || target === 'copilot' || (target === 'attendance' && ['OWNER', 'COUNSELOR', 'TRAINER'].includes(profile.role)) || (target === 'fees' && ['OWNER', 'ACCOUNTS'].includes(profile.role)) || (target === 'timetable' && ['OWNER', 'TRAINER', 'STUDENT'].includes(profile.role));
            return (
              <button
                key={label}
                type="button"
                disabled={!finalCanNavigate}
                className={`ep-nav__item${active === target && finalCanNavigate ? ' ep-nav__item--active' : ''}`}
                onClick={() => { onNavigate(target); setMenuOpen(false); }}
                title={finalCanNavigate ? label : 'This module is outside the current implementation scope'}
              >
                <Icon size={17} aria-hidden="true" /> <span>{label}</span>
              </button>
            );
          })}
        </nav>
        <button type="button" className="ep-sidebar__logout" onClick={onLogout}><LogOut size={17} /> Sign out</button>
      </aside>
      {menuOpen && <button className="ep-sidebar-backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
    </>
  );
}
