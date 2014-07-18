var vumigo = require('vumigo_v02');
var fixtures = require('./fixtures');
var AppTester = vumigo.AppTester;
var assert = require('assert');

var messagestore = require('./optoutstore');
var DummyOptoutResource = messagestore.DummyOptoutResource;


describe("app", function() {
    describe("for opting out of messages", function() {
        var app;
        var tester;

        beforeEach(function() {
            app = new go.app.GoNDOH();
            tester = new AppTester(app);

            tester
                .setup.config.app({
                    name: 'optout',
                    testing: 'true',
                    channel: "*120*550#1"
                })
                .setup.char_limit(140)
                .setup(function(api) {
                    api.contacts.add( {
                        msisdn: '+27001'
                    });
                })
                .setup(function(api) {
                    fixtures().forEach(api.http.fixtures.add);
                })
                .setup(function(api) {
                    api.resources.add(new DummyOptoutResource());
                    api.resources.attach(api);
                });
        });

        describe("when the user starts a session", function() {
            it("should ask for the reason they are opting out", function() {
                return tester
                    .start()
                    .check.interaction({
                        state: 'states_start',
                        reply: [
                            'Welcome to MomConnect. Please tell us why you don\'t ' +
                            'want msgs:',
                            '1. Had miscarriage',
                            '2. Baby stillborn',
                            '3. Baby died',
                            '4. Msgs not useful',
                            '5. Other'
                        ].join('\n')
                    })
                    .run();
            });
        });

        describe("when the user selects a reason for opting out", function() {
            it("should ask if they want further help", function() {
                return tester
                    .setup.user.addr('+27001')
                    .setup.user.state('states_start')
                    .input('1')
                    .check.interaction({
                        state: 'states_subscribe_option',
                        reply: [
                            'We are sorry for your loss. Would you like ' +
                            'to receive a small set of free messages ' +
                            'to help you in this difficult time?',
                            '1. Yes',
                            '2. No'
                        ].join('\n')
                    })
                    .check(function(api) {
                        var contact = api.contacts.store[0];
                        assert.equal(contact.extra.opt_out_reason, 'miscarriage');
                    })
                    .run();
            });
        });

        describe("when the user selects a reason for opting out 4 or 5", function() {
            it("should thank them and exit", function() {
                return tester
                    .setup.user.addr('+27001')
                    .setup.user.state('states_start')
                    .input('4')
                    .check.interaction({
                        state: 'states_end_no',
                        reply: ('Thank you. You will no longer receive ' +
                            'messages from us. If you have any medical ' +
                            'concerns please visit your nearest clinic.')
                    })
                    .check.reply.ends_session()
                    .check(function(api) {
                        var contact = api.contacts.store[0];
                        assert.equal(contact.extra.opt_out_reason, 'not_useful');
                    })
                    .run();
            });
        });

        describe("when the user selects no to futher help", function() {
            it("should thank them and exit", function() {
                return tester
                    .setup.user.addr('+27001')
                    .setup.user.state('states_subscribe_option')
                    .input('2')
                    .check.interaction({
                        state: 'states_end_no',
                        reply: ('Thank you. You will no longer receive ' +
                            'messages from us. If you have any medical ' +
                            'concerns please visit your nearest clinic.')
                    })
                    .check.reply.ends_session()
                    .run();
            });
        });

        describe("when the user selects yes to futher help", function() {
            it("should subscribe them and exit", function() {
                return tester
                    .setup.user.addr('+27001')
                    .setup.user.state('states_subscribe_option')
                    .input('1')
                    .check.interaction({
                        state: 'states_end_yes',
                        reply: ('Thank you. You will receive support messages ' +
                            'from MomConnect in the coming weeks.')
                    })
                    .check.reply.ends_session()
                    .run();
            });
        });

    });
});
