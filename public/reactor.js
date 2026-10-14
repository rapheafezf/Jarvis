// Arc reactor animé sur <canvas>. L'intensité suit le micro (écoute) ou une enveloppe simulée (parole).
(function () {
  const canvas = document.getElementById('canvas-reacteur');
  const ctx = canvas.getContext('2d');
  const CYAN = '0, 229, 255';

  const etat = {
    mode: 'repos', // repos | ecoute | reflexion | parole
    niveau: 0, // 0..1 lissé
    cible: 0,
    analyseur: null,
    donnees: null,
  };

  function redimensionner() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const taille = canvas.clientWidth || 420;
    canvas.width = taille * dpr;
    canvas.height = taille * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', redimensionner);
  redimensionner();

  function niveauMicro() {
    if (!etat.analyseur) return 0;
    etat.analyseur.getByteTimeDomainData(etat.donnees);
    let somme = 0;
    for (let i = 0; i < etat.donnees.length; i++) {
      const v = (etat.donnees[i] - 128) / 128;
      somme += v * v;
    }
    return Math.min(1, Math.sqrt(somme / etat.donnees.length) * 4);
  }

  function anneau(cx, cy, r, largeur, alpha, debut = 0, fin = Math.PI * 2) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, debut, fin);
    ctx.strokeStyle = `rgba(${CYAN}, ${alpha})`;
    ctx.lineWidth = largeur;
    ctx.stroke();
  }

  function dessiner(t) {
    const taille = canvas.clientWidth || 420;
    const cx = taille / 2;
    const cy = taille / 2;
    const R = taille * 0.42;
    const s = t / 1000;

    if (etat.mode === 'ecoute') etat.cible = niveauMicro();
    else if (etat.mode === 'parole') etat.cible = 0.35 + 0.35 * Math.abs(Math.sin(s * 9) * Math.sin(s * 3.7));
    else if (etat.mode === 'reflexion') etat.cible = 0.25 + 0.15 * Math.sin(s * 4);
    else etat.cible = 0.08 + 0.05 * Math.sin(s * 1.5);
    etat.niveau += (etat.cible - etat.niveau) * 0.15;
    const n = etat.niveau;

    ctx.clearRect(0, 0, taille, taille);
    ctx.save();
    ctx.shadowColor = `rgba(${CYAN}, 0.9)`;
    ctx.shadowBlur = 12 + n * 30;

    // Halo extérieur
    const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.15);
    halo.addColorStop(0, `rgba(${CYAN}, ${0.18 + n * 0.25})`);
    halo.addColorStop(1, 'rgba(0, 229, 255, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2);
    ctx.fill();

    // Anneau externe + graduations tournantes
    anneau(cx, cy, R, 2, 0.6);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(s * 0.25);
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const long = i % 5 === 0 ? 10 : 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (R - 6), Math.sin(a) * (R - 6));
      ctx.lineTo(Math.cos(a) * (R - 6 - long), Math.sin(a) * (R - 6 - long));
      ctx.strokeStyle = `rgba(${CYAN}, ${i % 5 === 0 ? 0.8 : 0.35})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();

    // Arcs segmentés en contre-rotation
    for (let i = 0; i < 3; i++) {
      const debut = -s * (0.8 + n) + (i * Math.PI * 2) / 3;
      anneau(cx, cy, R * 0.82, 6, 0.75, debut, debut + Math.PI * 0.45);
    }
    for (let i = 0; i < 4; i++) {
      const debut = s * 1.3 + (i * Math.PI) / 2;
      anneau(cx, cy, R * 0.7, 3, 0.5, debut, debut + Math.PI * 0.3);
    }

    // Bobines (10 segments trapézoïdaux, comme le réacteur de Stark)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-s * 0.1);
    for (let i = 0; i < 10; i++) {
      ctx.save();
      ctx.rotate((i / 10) * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(-R * 0.07, -R * 0.6);
      ctx.lineTo(R * 0.07, -R * 0.6);
      ctx.lineTo(R * 0.045, -R * 0.42);
      ctx.lineTo(-R * 0.045, -R * 0.42);
      ctx.closePath();
      ctx.fillStyle = `rgba(${CYAN}, ${0.25 + n * 0.5})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${CYAN}, 0.9)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // Ondes sonores autour du cœur
    const barres = 48;
    for (let i = 0; i < barres; i++) {
      const a = (i / barres) * Math.PI * 2;
      const amp = (0.3 + 0.7 * Math.abs(Math.sin(s * 6 + i * 0.7))) * n * R * 0.18;
      const r0 = R * 0.36;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * (r0 + 2 + amp), cy + Math.sin(a) * (r0 + 2 + amp));
      ctx.strokeStyle = `rgba(${CYAN}, 0.7)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Cœur lumineux pulsant
    const rc = R * (0.26 + n * 0.05);
    const coeur = ctx.createRadialGradient(cx, cy, 0, cx, cy, rc);
    coeur.addColorStop(0, 'rgba(255, 255, 255, 1)');
    coeur.addColorStop(0.35, `rgba(${CYAN}, ${0.85 + n * 0.15})`);
    coeur.addColorStop(1, `rgba(${CYAN}, 0.05)`);
    ctx.fillStyle = coeur;
    ctx.beginPath();
    ctx.arc(cx, cy, rc, 0, Math.PI * 2);
    ctx.fill();
    anneau(cx, cy, R * 0.3, 2, 0.9);

    ctx.restore();
    requestAnimationFrame(dessiner);
  }
  requestAnimationFrame(dessiner);

  window.Reacteur = {
    setMode(mode) {
      etat.mode = mode;
      document.body.dataset.mode = mode;
    },
    getMode() {
      return etat.mode;
    },
    brancherMicro(stream) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const actx = new AC();
        const source = actx.createMediaStreamSource(stream);
        etat.analyseur = actx.createAnalyser();
        etat.analyseur.fftSize = 512;
        etat.donnees = new Uint8Array(etat.analyseur.fftSize);
        source.connect(etat.analyseur);
      } catch (e) {
        console.warn('Analyse audio indisponible', e);
      }
    },
  };
})();
