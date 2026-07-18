/* 浮动音乐播放器：默认不自动播放，用户自主点击开启 */
(function () {
  var player = document.getElementById('musicPlayer');
  var audio = document.getElementById('bgm');
  var toggle = document.getElementById('mpToggle');
  var close = document.getElementById('mpClose');
  var status = document.getElementById('mpStatus');
  if (!player || !audio) return;

  if (localStorage.getItem('heypour_player_closed') === '1') {
    player.classList.add('mp-hidden');
  }

  toggle.addEventListener('click', function () {
    if (audio.paused) {
      audio.volume = 0.65;
      audio.play().then(function () {
        player.classList.add('playing');
        document.body.classList.add('music-on');
        status.textContent = '播放中 · 暖色钢琴与环境音';
      }).catch(function () {
        status.textContent = '浏览器拦截了播放，请再点一次';
      });
    } else {
      audio.pause();
      player.classList.remove('playing');
      document.body.classList.remove('music-on');
      status.textContent = '已暂停 · 轻点继续';
    }
  });

  close.addEventListener('click', function () {
    audio.pause();
    player.classList.add('mp-hidden');
    document.body.classList.remove('music-on');
    localStorage.setItem('heypour_player_closed', '1');
  });
})();
