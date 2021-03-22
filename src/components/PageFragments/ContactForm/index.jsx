import { Col, Form, Input, Button, message } from 'antd';
import React from 'react';
import Config from '../../../../config';

const validateMessages = {
  required: '请填写完整信息~ ',
};
export default () => {
  const [form] = Form.useForm();
  const onFinish = data => {
    const formData = new FormData();
    // eslint-disable-next-line no-restricted-syntax
    for (const key in data) {
      if (data[key]) {
        formData.append(key, data[key]);
      }
    }

    fetch(Config.contactFormUrl, { method: 'POST', body: formData })
      .then(() => {
        message.success('感谢你的咨询，我会尽快回复🙂');
        form.resetFields();
      })
      // eslint-disable-next-line no-console
      .catch(error => console.error('Error:', error));
  };

  return (
    <Col sm={24} md={24} lg={12} className="widthFull">
      <Form
        form={form}
        name="nest-messages"
        onFinish={onFinish}
        validateMessages={validateMessages}
      >
        <Form.Item name={['name']} rules={[{ required: true }]}>
          <Input size="large" placeholder="姓名*" />
        </Form.Item>
        <Form.Item name={['contact']} rules={[{ required: true }]}>
          <Input size="large" placeholder="手机/邮箱/微信*" />
        </Form.Item>
        <Form.Item name={['description']} rules={[{ required: true }]}>
          <Input.TextArea size="large" rows={7} placeholder="问题描述 *" />
        </Form.Item>
        <Form.Item>
          <Button
            type="primary"
            shape="round"
            size="large"
            htmlType="submit"
            style={{ background: '#304CFD' }}
          >
            提交
          </Button>
        </Form.Item>
      </Form>
    </Col>
  );
};
