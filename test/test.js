require('fs').readdirSync(__dirname).forEach(function(f) {
  if (f.substr(0, 5) === 'test-') {
    console.log('running test', f);
    require('./' + f);
    console.log("%s done", f);
  }
});

