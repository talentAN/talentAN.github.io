import React, { useState } from 'react';
import { Empty, Typography } from 'antd';
import keyLogsData from '../../../data/key-logs.json';

const { Paragraph } = Typography;

const KeyLog = () => {
  const [logs] = useState(keyLogsData);

  const sortedLogs = [...logs].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div>
      {sortedLogs.length === 0 ? (
        <Empty description="暂无日志" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {sortedLogs.map(log => (
            <div key={log.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ marginBottom: 8, color: '#333', fontWeight: 600 }}>{log.date}</div>
              <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                {log.content}
              </Paragraph>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default KeyLog;
