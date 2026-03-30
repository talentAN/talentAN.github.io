import React, { useEffect, useState } from 'react';
import QuickCalc from './index';
import BitgetMonitor from './tabs/BitgetMonitor';

const BitgetMonitorPage = ({ location }) => {
  const [mode, setMode] = useState('stable');

  useEffect(() => {
    const params = new URLSearchParams(location?.search);
    const modeParam = params.get('mode');
    if (modeParam) {
      setMode(modeParam);
    }
  }, [location?.search]);

  return (
    <QuickCalc location={location}>
      <BitgetMonitor mode={mode} />
    </QuickCalc>
  );
};

export default BitgetMonitorPage;
