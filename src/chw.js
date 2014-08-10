go.app = function() {
    var vumigo = require('vumigo_v02');
    var _ = require('lodash');
    var moment = require('moment');
    var Q = require('q');
    var App = vumigo.App;
    var Choice = vumigo.states.Choice;
    var ChoiceState = vumigo.states.ChoiceState;
    var EndState = vumigo.states.EndState;
    var FreeText = vumigo.states.FreeText;

    var GoNDOH = App.extend(function(self) {
        App.call(self, 'states_start');
        var $ = self.$;

        self.init = function() {
            self.env = self.im.config.env;
            self.metric_prefix = [self.env, self.im.config.name].join('.');
            self.store_name = [self.env, self.im.config.name].join('.');

            self.im.on('session:new', function(e) {
                self.user.extra.ussd_sessions = go.utils.incr_user_extra(
                    self.user.extra.ussd_sessions, 1);
                self.user.extra.metric_sum_sessions = go.utils.incr_user_extra(self.user.extra.metric_sum_sessions, 1);

                return Q.all([
                    self.im.contacts.save(self.user),
                    self.im.metrics.fire.inc([self.env, 'sum.sessions'].join('.'), 1),
                    self.fire_incomplete(e.im.state.name, -1)
                ]);
            });

            self.im.on('session:close', function(e) {
                return Q.all([
                    self.fire_incomplete(e.im.state.name, 1),
                    self.dial_back(e)
                ]);
            });

            self.im.user.on('user:new', function(e) {
                return Q.all([
                    go.utils.fire_users_metrics(self.im, self.store_name, self.env, self.metric_prefix),
                    self.fire_incomplete('states_start', 1)
                ]);
            });

            self.im.on('state:enter', function(e) {
                self.contact.extra.last_state = e.state.name;
                return self.im.contacts.save(self.contact);
            });
            
            return self.im.contacts
                .for_user()
                .then(function(user_contact) {
                    if ((!_.isUndefined(user_contact.extra.working_on)) && (user_contact.extra.working_on !== "")){
                        self.user = user_contact;
                        return self.im.contacts
                            .get(user_contact.extra.working_on, {create: true})
                            .then(function(working_on){
                                self.contact = working_on;
                            });
                    } else {
                        self.user = user_contact;
                        self.contact = user_contact;
                    }
                });
        };

        self.should_send_dialback = function(e) {
            return e.user_terminated
                && !go.utils.is_true(self.contact.extra.redial_sms_sent);
        };

        self.send_dialback = function() {
            return self.im.outbound
                .send_to_user({
                    endpoint: 'sms',
                    content: self.get_finish_reg_sms()
                })
                .then(function() {
                    self.contact.extra.redial_sms_sent = 'true';
                    return self.im.contacts.save(self.contact);
                });
        };

        self.dial_back = function(e) {
            if (!self.should_send_dialback(e)) { return; }
            return self.send_dialback();
        };

        self.get_finish_reg_sms = function() {
            return $("Please dial back in to {{ USSD_number }} to complete the pregnancy registration.")
                .context({
                    USSD_number: self.im.config.channel
                });
        };

        self.fire_incomplete = function(name, val) {
            var ignore_states = ['states_end_success'];
            if (!_.contains(ignore_states, name)) {
                return self.im.metrics.fire.inc(([self.metric_prefix, name, "no_incomplete"].join('.')), {amount: val});
            }
        };

        self.add = function(name, creator) {
            self.states.add(name, function(name, opts) {
                opts = _.defaults(opts || {}, {in_header: true});

                if (!opts.in_header || !go.utils.timed_out(self.im))
                    return creator(name, opts);

                opts.name = name;
                opts.in_header = false;
                return self.states.create('states_timed_out', opts);
                
            });
        };

        self.add('states_timed_out', function(name, creator_opts) {
            var readable_no = go.utils.readable_sa_msisdn(self.contact.msisdn);

            return new ChoiceState(name, {
                question: $('Would you like to complete pregnancy registration for ' +
                            '{{ num }}?')
                    .context({ num: readable_no }),

                choices: [
                    new Choice(creator_opts.name, $('Yes')),
                    new Choice('states_start', $('Start new registration'))
                ],

                next: function(choice) {
                    if (choice.value === 'states_start') {
                        self.user.extra.working_on = "";
                    }

                    return self.im.contacts
                        .save(self.user)
                        .then(function() {
                            return {
                                name: choice.value,
                                creator_opts: creator_opts
                            };
                        });
                }
            });
        });

        self.add('states_start', function(name) {
            var readable_no = go.utils.readable_sa_msisdn(self.im.user.addr);

            return new ChoiceState(name, {
                question: $('Welcome to The Department of Health\'s ' +
                            'MomConnect. Tell us if this is the no. that ' +
                            'the mother would like to get SMSs on: {{ num }}')
                    .context({ num: readable_no }),

                choices: [
                    new Choice('yes', $('Yes')),
                    new Choice('no', $('No'))
                ],

                next: function(choice) {
                    return self.im.contacts
                        .save(self.contact)
                        .then(function() {
                            return {
                                yes: 'states_id_type',
                                no: 'states_mobile_no'
                            } [choice.value];
                        });
                }
            });
        });

        self.add('states_mobile_no', function(name, opts) {
            var error = $('Sorry, the mobile number did not validate. ' +
                          'Please reenter the mobile number:');

            var question = $('Please input the mobile number of the ' +
                            'pregnant woman to be registered:');

            return new FreeText(name, {
                question: question,

                check: function(content) {
                    if (!go.utils.check_valid_number(content)) {
                        return error;
                    }
                },

                next: function(content) {
                    msisdn = go.utils.normalise_sa_msisdn(content);
                    self.contact.extra.working_on = msisdn;

                    return self.im.contacts
                        .save(self.contact)
                        .then(function() {
                            return {
                                name: 'states_id_type'
                            };
                        });
                }
            });
        });

        self.add('states_id_type', function(name) {
            return new ChoiceState(name, {
                question: $('What kind of identification does the pregnant ' +
                            'mother have?'),

                choices: [
                    new Choice('sa_id', $('SA ID')),
                    new Choice('passport', $('Passport')),
                    new Choice('none', $('None'))
                ],

                next: function(choice) {
                    self.contact.extra.id_type = choice.value;

                    return self.im.contacts
                        .save(self.contact)
                        .then(function() {
                            if (_.isUndefined(self.contact.extra.is_registered)) {
                                return Q.all([
                                    go.utils.incr_kv(self.im, [self.store_name, 'no_incomplete_registrations'].join('.')),
                                    go.utils.adjust_percentage_registrations(self.im, self.metric_prefix)
                                ]);
                            }
                        })
                        .then(function() {
                            self.contact.extra.is_registered = 'false';
                            return {
                                sa_id: 'states_sa_id',
                                passport: 'states_passport_origin',
                                none: 'states_birth_year'
                            } [choice.value];
                        });
                }
            });
        });

        self.add('states_sa_id', function(name, opts) {
            var error = $('Sorry, the mother\'s ID number did not validate. ' +
                          'Please reenter the SA ID number:');

            var question = $('Please enter the pregnant mother\'s SA ID ' +
                            'number:');

            return new FreeText(name, {
                question: question,

                check: function(content) {
                    if (!go.utils.validate_id_sa(content)) {
                        return error;
                    }
                },

                next: function(content) {
                    self.contact.extra.sa_id = content;

                    var id_date_of_birth = go.utils.extract_id_dob(content);
                    self.contact.extra.birth_year = moment(id_date_of_birth, 'YYYY-MM-DD').format('YYYY');
                    self.contact.extra.birth_month = moment(id_date_of_birth, 'YYYY-MM-DD').format('MM');
                    self.contact.extra.birth_day = moment(id_date_of_birth, 'YYYY-MM-DD').format('DD');
                    self.contact.extra.dob = id_date_of_birth;

                    return self.im.contacts
                        .save(self.contact)
                        .then(function() {
                            return {
                                name: 'states_language'
                            };
                        });
                }
            });
        });

        self.add('states_passport_origin', function(name) {
            return new ChoiceState(name, {
                question: $('What is the country of origin of the passport?'),

                choices: [
                    new Choice('zw', $('Zimbabwe')),
                    new Choice('mz', $('Mozambique')),
                    new Choice('mw', $('Malawi')),
                    new Choice('ng', $('Nigeria')),
                    new Choice('cd', $('DRC')),
                    new Choice('so', $('Somalia')),
                    new Choice('other', $('Other'))
                ],

                next: function(choice) {
                    self.contact.extra.passport_origin = choice.value;

                    return self.im.contacts
                        .save(self.contact)
                        .then(function() {
                            return {
                                name: 'states_passport_no'
                            };
                        });
                }
            });
        });

        self.add('states_passport_no', function(name) {
            var error = $('There was an error in your entry. Please ' +
                        'carefully enter the passport number again.');
            var question = $('Please enter the pregnant mother\'s Passport number:');

            return new FreeText(name, {
                question: question,

                check: function(content) {
                    if (!go.utils.is_alpha_numeric_only(content) || content.length <= 4) {
                        return error;
                    }
                },

                next: function(content) {
                    self.contact.extra.passport_no = content;

                    return self.im.contacts
                        .save(self.contact)
                        .then(function() {
                            return {
                                name: 'states_language'
                            };
                        });
                }
            });
        });

        self.add('states_birth_year', function(name, opts) {
            var error = $('There was an error in your entry. Please ' +
                        'carefully enter the mother\'s year of birth again ' +
                        '(for example: 2001)');

            var question = $('Please enter the year that the pregnant ' +
                    'mother was born (for example: 1981)');

            return new FreeText(name, {
                question: question,

                check: function(content) {
                    if (!go.utils.check_number_in_range(content, 1900, go.utils.get_today(self.im.config).getFullYear())) {
                        return error;
                    }
                },

                next: function(content) {
                    self.contact.extra.birth_year = content;

                    return self.im.contacts
                        .save(self.contact)
                        .then(function() {
                            return {
                                name: 'states_birth_month'
                            };
                        });
                }
            });
        });

        self.add('states_birth_month', function(name) {
            return new ChoiceState(name, {
                question: $('Please enter the month that you were born.'),

                choices: go.utils.make_month_choices($, 0, 12),

                next: function(choice) {
                    self.contact.extra.birth_month = choice.value;

                    return self.im.contacts
                        .save(self.contact)
                        .then(function() {
                            return {
                                name: 'states_birth_day'
                            };
                        });
                }
            });
        });

        self.add('states_birth_day', function(name, opts) {
            var error = $('There was an error in your entry. Please ' +
                        'carefully enter the mother\'s day of birth again ' +
                        '(for example: 8)');

            var question = $('Please enter the day that the mother was born ' +
                    '(for example: 14).');

            return new FreeText(name, {
                question: question,

                check: function(content) {
                    if (!go.utils.check_number_in_range(content, 1, 31)) {
                        return error;
                    }
                },

                next: function(content) {
                    if (content.length === 1) {
                        content = '0' + content;
                    }
                    self.contact.extra.birth_day = content;
                    self.contact.extra.dob = moment({year: self.im.user.answers.states_birth_year, month: (self.im.user.answers.states_birth_month - 1), day: content}).format('YYYY-MM-DD');
                    // -1 for 0-bound month


                    return self.im.contacts
                        .save(self.contact)
                        .then(function() {
                            return {
                                name: 'states_language'
                            };
                        });
                }
            });
        });

        self.add('states_language', function(name) {
            return new ChoiceState(name, {
                question: $('Please select the language that the ' +
                            'pregnant mother would like to get messages in:'),

                choices: [
                    new Choice('en', $('English')),
                    new Choice('af', $('Afrikaans')),
                    new Choice('zu', $('Zulu')),
                    new Choice('xh', $('Xhosa')),
                    new Choice('st', $('Sotho')),
                    new Choice('tn', $('Setswana'))
                ],

                next: function(choice) {
                    self.contact.extra.language_choice = choice.value;
                    self.contact.extra.is_registered = 'true';
                    self.contact.extra.is_registered_by = 'chw';
                    self.contact.extra.metric_sessions_to_register = self.user.extra.ussd_sessions;

                    return self.im.groups.get(choice.value)
                        .then(function(group) {
                            self.contact.groups.push(group.key);
                            return self.im.user
                                .set_lang(choice.value)
                                // we may not have to run this for this flow
                                .then(function() {
                                    return self.im.contacts.save(self.contact);
                                })
                                .then(function() {
                                    return Q.all([
                                        self.im.metrics.fire.avg((self.metric_prefix + ".avg.sessions_to_register"),
                                            parseInt(self.user.extra.ussd_sessions, 10)),
                                        go.utils.incr_kv(self.im, [self.store_name, 'no_complete_registrations'].join('.')),
                                        go.utils.decr_kv(self.im, [self.store_name, 'no_incomplete_registrations'].join('.')),
                                        go.utils.adjust_percentage_registrations(self.im, self.metric_prefix)
                                    ]);
                                })
                                .then(function() {
                                    if (!_.isUndefined(self.user.extra.working_on) && (self.user.extra.working_on !== "")) {
                                        self.user.extra.working_on = "";
                                        self.user.extra.no_registrations = go.utils.incr_user_extra(self.user.extra.no_registrations, 1);
                                        self.contact.extra.registered_by = self.user.msisdn;
                                    }
                                    self.user.extra.ussd_sessions = '0';
                                    return Q.all([
                                        self.im.contacts.save(self.user),
                                        self.im.contacts.save(self.contact)
                                    ]);
                                })
                                .then(function() {
                                    return 'states_end_success';
                                });
                        });
                }
            });
        });

        self.add('states_end_success', function(name) {
            return new EndState(name, {
                text: $('Thank you, registration is complete. The pregnant ' +
                        'woman will now receive messages to encourage her ' +
                        'to register at her nearest clinic.'),

                next: 'states_start',

                events: {
                    'state:enter': function() {
                        opts = go.utils.subscription_type_and_rate(self.contact, self.im);
                        self.contact.extra.subscription_type = opts.sub_type.toString();
                        self.contact.extra.subscription_rate = opts.sub_rate.toString();
                        if (self.contact.extra.id_type !== undefined){
                            if (self.contact.extra.id_type === 'none') {
                                return Q.all([
                                    go.utils.jembi_send_json(self.contact, self.user, 'pre-registration', self.im, self.metric_prefix),
                                    go.utils.subscription_send_doc(self.contact, self.im, self.metric_prefix, opts),
                                    self.im.outbound.send({
                                        to: self.contact,
                                        endpoint: 'sms',
                                        content: $("Congratulations on your pregnancy. You will now get free SMSs about MomConnect. " +
                                                 "You can register for the full set of FREE helpful messages at a clinic.")
                                    }),
                                    self.im.contacts.save(self.contact)
                                ]);
                            } else {
                                return Q.all([
                                    go.utils.jembi_send_doc(self.contact, self.user, self.im, self.metric_prefix),
                                    go.utils.jembi_send_json(self.contact, self.user, 'pre-registration', self.im, self.metric_prefix),
                                    go.utils.subscription_send_doc(self.contact, self.im, self.metric_prefix, opts),
                                    self.im.outbound.send({
                                        to: self.contact,
                                        endpoint: 'sms',
                                        content: $("Congratulations on your pregnancy. You will now get free SMSs about MomConnect. " +
                                                 "You can register for the full set of FREE helpful messages at a clinic.")
                                    }),
                                    self.im.contacts.save(self.contact)
                                ]);
                            }
                        }
                    }
                }
            });
        });

    });

    return {
        GoNDOH: GoNDOH
    };
}();
