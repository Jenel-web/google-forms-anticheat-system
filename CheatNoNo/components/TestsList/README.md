The tests list is the dashboard home: three summary stats, a search box and a table of tests with status, students and flag count.

The consumer provides the tests and the New test action. Under 760px the sidebar becomes a top bar plus a bottom tab bar and each row becomes a labelled card (cells carry `data-label`). Draft, live and ended map to the matching `cn-chip` states; zero flags show a dash, not a chip.

Do sort live tests first. Don't show student names on this screen.