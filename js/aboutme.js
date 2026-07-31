  /* ---------- about me (free-text appearance details) ---------- */
  function renderAboutMe(){
    el('amRace').value = state.profile.race || '';
    el('amSkinTone').value = state.profile.skinTone || '';
    el('amHairColor').value = state.profile.hairColor || '';
    el('amHairStyle').value = state.profile.hairStyle || '';
    el('amEyeColor').value = state.profile.eyeColor || '';
    el('amClothing').value = state.profile.clothing || '';
    el('amBackground').value = state.profile.background || '';
  }
  ['amRace','amSkinTone','amHairColor','amHairStyle','amEyeColor','amClothing','amBackground'].forEach(id=>{
    el(id).addEventListener('change', ()=>{
      state.profile.race = el('amRace').value;
      state.profile.skinTone = el('amSkinTone').value;
      state.profile.hairColor = el('amHairColor').value;
      state.profile.hairStyle = el('amHairStyle').value;
      state.profile.eyeColor = el('amEyeColor').value;
      state.profile.clothing = el('amClothing').value;
      state.profile.background = el('amBackground').value;
      save();
    });
  });

