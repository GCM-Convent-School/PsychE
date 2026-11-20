# Product Requirements Document (PRD)
**Project Name:** PsychE - Student Counseling CRM (Basic Edition)
**Target Platform:** Web Application (Optimized for desktop/macOS environments)
**Architecture Style:** Lightweight, Low-Overhead ("Antigravity" approach)
**Backend Database:** Supabase (Tables prefixed with `PsychE_`)

## 1. Product Overview
PsychE is a streamlined, mini-CRM designed specifically for school counselors to digitize and manage student psychological evaluation records. Moving away from heavy, complex workloads, this application focuses on a frictionless data entry experience, rapid retrieval of student history, and professional output generation.

## 2. Design & UI/UX Language
* **Layout Paradigm:** The primary dashboard and student views should utilize a modern **Bento Grid** layout. Information should be compartmentalized into clean, distinct cards (e.g., Personal Details card, Quick Actions card, Recent Logs timeline card) on a single screen to avoid unnecessary navigation.
* **Aesthetics:** Minimalist, high-contrast, and intuitive. Avoid heavy UI clutter. 
* **Responsiveness:** Primarily desktop-focused for administrative use, ensuring crisp rendering and fluid interactions.
* **AI-Agent Friendly:** The application structure should be modular and straightforward, making it easy to maintain or expand using CLI AI coding assistants in the future.

## 3. Core User Journeys
### Journey 1: Search & Review
* **Action:** User searches for a student via a global search bar (Name, ID, or Phone).
* **Result:** The system navigates to the Student's "Bento" Dashboard.
* **View:** Displays basic personal details, a chronological timeline of past psychological evaluations, and action buttons.

### Journey 2: Log Entry
* **Action:** User clicks "Add New Log".
* **Flow:** A clean modal or dedicated route opens. The user can either select an existing student or quickly add a new student inline.
* **Input:** Form captures Counsellor Name, Date, Reason, Student Response, Recommended Action, and Checkboxes for File Update/Notification.
* **Result:** Log is saved to `PsychE_Counseling_Logs` and instantly appears in the student's timeline.

### Journey 3: Bulk Onboarding
* **Action:** Administrator uploads a CSV file containing the yearly student roster.
* **Processing:** The system maps CSV columns to `PsychE_Students` (Full Name, Father's Name, Mother's Name, Mobile, Course, Start/End dates) and performs a bulk insert/upsert.
* **Result:** Hundreds of student profiles are instantly searchable, ready for individual log attachments.

## 4. Key Features Breakdown

### 4.1. Mission Control Dashboard
* **Global Search:** Fast-filtering search input.
* **Recent Activity:** A quick-glance widget showing the most recently added counseling logs across the school.
* **Quick Add:** A floating action button (FAB) or prominent header button to immediately start a new log entry.

### 4.2. Student Profile View
* **Details Card:** Displays immutable student info.
* **History Timeline:** A scrollable list of past sessions. Expanding a session shows the full text of the counselor's notes.
* **Edit/Update:** Ability to update phone numbers or course details.

### 4.3. Print & Export Engine
* **A4 Formatting:** A dedicated "Print View" button on the Student Profile.
* **Behavior:** When triggered, the application strips away all navigation, sidebars, and dark-mode styles. It dynamically generates a clean, structured HTML view styled specifically for A4 paper (`@media print` CSS rules), replicating the formal structure of the physical "Student Counseling Record" sheet for physical filing.

## 5. Technical Requirements & Database Schema Integration
* **Data Layer:** Connect strictly to the provided Supabase PostgreSQL schema.
* **Entities:**
  * `PsychE_Students`: Master record for demographics.
  * `PsychE_Counseling_Logs`: Transactional records linked via `student_uuid`.
* **Performance:** Keep external dependencies to an absolute minimum. Use native browser features for printing and basic HTML/JS/CSS or a lightweight framework for the frontend to ensure a "no heavy workload" execution.

## 6. Version 2.0 Changes (Advanced Scheduling & Security)
The application has been upgraded to **Version 2.0**, introducing proactive task management, strict capacity enforcement, and enhanced security mechanisms:

### 6.1. Capacity-Aware Task Management
* **Global Capacity Limits:** Administrators can define a maximum number of sessions a counselor can handle per day (e.g., 7 sessions) via a Settings dashboard.
* **7-Day Kanban Planner:** A rolling 7-day visual planner displaying scheduled sessions as cards. Includes drag-and-drop capability to rapidly reschedule sessions across days.
* **Overdue Tracking & Task Completion:** The system automatically identifies past-due scheduled sessions and pushes them to a red "Overdue" column. Tasks can be marked "Completed" directly from the board, prompting the user for session notes.
* **Visual Scheduling:** The "Add Log" interface uses an interactive date picker that explicitly prevents overbooking by highlighting full days.
* **Bulk Auto-Scheduler:** A utility to select multiple students and automatically distribute their initial sessions across available upcoming dates, perfectly filling capacity limits.

### 6.2. Security & Application Control
* **PIN Access Screen:** The entire application is protected by a glassmorphic PIN entry screen.
* **Dynamic Settings:** Authorized security PINs and the current App Version string are stored in the database (`PsychE_Settings`) and can be managed directly via the UI.
* **High-Risk Flagging:** Students tagged as high-risk are heavily highlighted across the Kanban board and Dashboard for immediate triage.

## 7. Version 3.0 Changes (Relational Assessment CMS & Global Tags)
The application has been upgraded to **Version 3.0**, introducing a robust, relational schema and enterprise-grade CMS features to handle complex psychological assessments and student tracking:

### 7.1. Assessment Library CMS (Master-Detail Architecture)
* **Relational Schema:** Migrated from a monolithic JSON structure to a fully relational database model (`PsychE_Modules` and `PsychE_Questions`), allowing for scalable and complex questionnaires.
* **Apple-Style Master-Detail Interface:** A premium, two-pane UI (Master list of modules on the left, Question detail view on the right) for managing the assessment library.
* **Question Management:** Support for reverse-scoring logic, active/inactive toggles (soft-deletes), and custom labeling (Likert and custom MCQ).
* **One-Time Edit Lock:** Formal test modules can be locked; questions within locked modules can only be edited once, preventing accidental corruption of standardized testing material.
* **Smart Keywords:** Inline pill-badge keyword manager for modules to trigger dynamic test suggestions during counseling logs.

### 7.2. Global Tagging System
* **Global System Tags:** A dedicated manager for administrators to create categorized "Problem System" tags (e.g., Behavioral, Academic, Career, Custom).
* **Enterprise Data Grid:** A highly scannable, premium table interface with color swatches and categorization to manage tags.
* **Student Tag Assignment:** Ability to assign these global tags directly to student profiles via junction tables (`PsychE_Student_Tags`), allowing for rapid identification of specific issues across the student body.
* **Aesthetics & Micro-Interactions:** Upgraded UI with glassmorphic elements, staggered fade-in animations, inline editing toolbars, and premium hover states.