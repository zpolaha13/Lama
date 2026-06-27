/* =========================================================================
 * print.js — Build printable matchup scorecards.
 *
 * Renders one card per group/matchup in a round, showing each player's
 * strokes received per hole (dots), their handicap, tee, and blank or filled
 * score boxes. Designed for letter-size paper, one card per page.
 * ========================================================================= */

(function (global) {
  'use strict';

  const Print = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  }

  function dots(n) {
    if (n <= 0) return '';
    let out = '';
    for (let i = 0; i < n; i++) out += '•';
    return '<span class="stroke-dot">' + out + '</span>';
  }

  /* group: { name, players:[{name, courseHandicap, teeName}] }
   * holes: [{par, si}]
   * scores: function(playerId, holeIndex) -> gross|null  (optional)
   * playerIds: parallel to group.players for score lookup
   */
  Print.scorecardHTML = function (opts) {
    const { title, subtitle, holes, players } = opts;
    const n = holes.length;
    const front = holes.slice(0, 9);
    const back = holes.slice(9);
    const hasBack = back.length > 0;

    function section(holeSlice, offset, label) {
      let h = '<tr class="hole-row"><th class="name">Hole</th>';
      holeSlice.forEach((_, i) => (h += '<th>' + (offset + i + 1) + '</th>'));
      h += '<th>' + label + '</th></tr>';

      let par = '<tr class="par-row"><td class="name">Par</td>';
      let parSum = 0;
      holeSlice.forEach((hole) => {
        par += '<td>' + hole.par + '</td>';
        parSum += hole.par;
      });
      par += '<td>' + parSum + '</td>';

      let si = '<tr class="si-row"><td class="name">Hcp (SI)</td>';
      holeSlice.forEach((hole) => (si += '<td>' + hole.si + '</td>'));
      si += '<td></td>';

      let rows = '';
      players.forEach((p) => {
        let r = '<tr><td class="name">' + esc(p.name) +
          ' <span class="muted">(' + (p.courseHandicap >= 0 ? p.courseHandicap : p.courseHandicap) + ')</span></td>';
        let strokeSum = 0;
        let scoreSum = 0;
        let anyScore = false;
        holeSlice.forEach((hole, i) => {
          const idx = offset + i;
          const strokes = Golf.strokesOnHole(p.courseHandicap, hole.si, n);
          strokeSum += strokes;
          const g = p.getScore ? p.getScore(idx) : null;
          let cell = dots(strokes);
          if (g != null && g !== '' && !isNaN(g)) {
            anyScore = true;
            scoreSum += Number(g);
            cell = '<strong>' + g + '</strong> ' + dots(strokes);
          }
          r += '<td>' + (cell || '&nbsp;') + '</td>';
        });
        r += '<td>' + (anyScore ? scoreSum : '') + '</td></tr>';
        rows += r;
      });
      return h + par + si + rows;
    }

    let table = '<table>';
    table += section(front, 0, 'Out');
    if (hasBack) table += section(back, 9, 'In');
    table += '</table>';

    return (
      '<div class="scorecard">' +
      '<h3>' + esc(title) + '</h3>' +
      '<div class="sub">' + esc(subtitle || '') + '</div>' +
      table +
      '</div>'
    );
  };

  global.Print = Print;
})(typeof window !== 'undefined' ? window : this);
